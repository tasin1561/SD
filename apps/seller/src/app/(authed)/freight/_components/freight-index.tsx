'use client';

import Link from 'next/link';

import { useState, type ReactElement } from 'react';
import {
  Card,
  CardBody,
  EmptyState,
  ErrorNote,
  FreightStatusBadge,
  Ident,
  Money,
  Num,
  PageHeader,
  Select,
  SkeletonRows,
  Stat,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Toolbar,
  Tr,
} from '@skydrop/ui/components';
import { InboundFreightStatus, type InboundFreightMode } from '@skydrop/db';
import { useSellerFreight } from '@/lib/ops-hooks';

/**
 * What it cost to get each consignment into India, and how much of that
 * is still owed.
 *
 * Read-only by design: freight is billed by Skydrop and settled from the
 * wallet, so there is nothing here for a seller to change. What they
 * need is the arithmetic — the per-unit amortisation means a bill does
 * not become fully payable until the consignment has actually sold, and
 * that is not obvious unless the screen shows it.
 */
export function SellerFreightIndex(): ReactElement {
  const [status, setStatus] = useState<string>('');
  const list = useSellerFreight(status === '' ? {} : { status });

  const rows = list.data?.items ?? [];
  // The API's own figure covers live bills; on the withdrawn filter the
  // rows carry an arithmetic outstanding that is not a debt, so the
  // total is taken from the rows that are actually owed.
  const outstanding =
    status === InboundFreightStatus.VOIDED ? '0' : (list.data?.outstandingInr ?? '0');

  return (
    <div>
      <PageHeader
        title="Inbound freight"
        subtitle="The shipping cost of getting your stock from Bangladesh into our Indian warehouse. Charged per unit as the stock sells, not all at once."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Stat
          label="Still owed"
          value={<Money amount={outstanding} decimals={false} />}
          tone={Number(outstanding) > 0 ? 'warn' : 'good'}
          hint="Recovered from your wallet as the stock sells"
        />
        <Stat
          label="Consignments billed"
          value={list.isLoading ? '—' : rows.length}
          hint={status === '' ? 'All statuses' : humanise(status)}
        />
      </div>

      <Toolbar>
        <label className="text-text-muted text-xs" htmlFor="seller-freight-status">
          Status
        </label>
        <Select
          id="seller-freight-status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-56"
        >
          <option value="">All statuses</option>
          {Object.values(InboundFreightStatus).map((s) => (
            <option key={s} value={s}>
              {humanise(s)}
            </option>
          ))}
        </Select>
      </Toolbar>

      {list.isError ? (
        <Card className="rounded-t-none border-t-0 p-3">
          <ErrorNote
            message={list.error?.message ?? 'Failed to load freight bills.'}
            retry={() => void list.refetch()}
          />
        </Card>
      ) : list.isLoading ? (
        <Card className="rounded-t-none border-t-0">
          <SkeletonRows rows={4} cols={6} />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="rounded-t-none border-t-0">
          <EmptyState
            bare
            title="No freight bills yet"
            description="A bill appears here once we receive a consignment from you and record what the freight cost."
          />
        </Card>
      ) : (
        <Table wrapperClassName="rounded-t-none border-t-0">
          <THead>
            <Tr>
              <Th>Consignment</Th>
              <Th>Terms</Th>
              <Th align="right">Total</Th>
              <Th align="right">Charged so far</Th>
              <Th align="right">Still owed</Th>
              <Th>Units sold</Th>
              <Th>Status</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td>
                  {/* The bill is for one ARRIVAL, but the details a seller
                      wants — what was declared, what was counted, where it
                      is — live on the consignment, so that is where this
                      goes. */}
                  <Link href={`/inbound/${r.consignmentId}`} className="hover:underline">
                    <Ident value={r.receiptNumber ?? `${r.goodsReceiptId.slice(0, 8)}…`} />
                  </Link>
                  <div className="text-text-faint mt-0.5 text-xs">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </div>
                  {r.voidedAt !== null && (
                    <div className="text-text-muted mt-1 text-xs">
                      Withdrawn {new Date(r.voidedAt).toLocaleDateString()} — this bill was wrong
                      and anything it charged has gone back to your wallet.
                      {r.voidReason === null ? '' : ` ${r.voidReason}`}
                    </div>
                  )}
                </Td>
                <Td className="text-text-muted whitespace-nowrap text-xs">
                  {TERMS_WORDS[r.mode]}
                  {r.serviceChargeInr !== null && Number(r.serviceChargeInr) > 0 && (
                    <div className="text-text-faint">
                      includes <Money amount={r.serviceChargeInr} decimals={false} /> service charge
                    </div>
                  )}
                </Td>
                <Td align="right">
                  <Money amount={r.totalInr} />
                  {/* The figure agreed on the phone, when that was not
                      rupees. Without it "why ₹162.60?" has no answer,
                      and the rate is the thing the seller actually
                      negotiated. */}
                  {r.agreedCurrency !== 'INR' && (
                    <div className="text-text-faint text-xs">
                      <Money amount={r.agreedAmount} currency={r.agreedCurrency} convert={false} />{' '}
                      agreed
                    </div>
                  )}
                </Td>
                <Td align="right">
                  <Money amount={r.amountSettledInr} />
                </Td>
                <Td align="right">
                  {/* A withdrawn bill still computes total minus
                      settled; it is not a debt. Showing the arithmetic
                      would tell a seller they owe money we took back. */}
                  {r.voidedAt !== null ? (
                    <span className="text-text-faint text-xs">Nothing — withdrawn</span>
                  ) : Number(r.outstandingInr) === 0 ? (
                    <span className="text-text-faint">—</span>
                  ) : (
                    <Money amount={r.outstandingInr} direction="debit" />
                  )}
                </Td>
                <Td className="text-text-muted whitespace-nowrap text-xs">
                  <Num value={r.unitsSettled} /> / <Num value={r.totalUnits} />
                </Td>
                <Td>
                  <FreightStatusBadge status={r.status} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      <Card className="mt-4">
        <CardBody>
          <p className="text-text-muted text-xs leading-relaxed">
            On pay-as-it-sells terms, each unit carries its share of the consignment&apos;s freight,
            and that share is deducted from your wallet when the unit is delivered. Stock still
            sitting in the warehouse has not been charged for yet — which is why a bill can stay
            partly owed for a long time without anything being wrong.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * What each mode means TO THE SELLER — where the bill lands, not what
 * we call it internally. Pay-in-advance is billed in Dhaka before the
 * goods fly, which is a different moment from the other two and the
 * one a seller most needs to recognise.
 */
const TERMS_WORDS: Record<InboundFreightMode, string> = {
  PAY_ADVANCE: 'Paid before it flew',
  PAY_NOW: 'Paid on arrival',
  PAY_LATER: 'Pay as it sells',
};

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
