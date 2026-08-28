'use client';

import { useState, type ReactElement } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  Money,
  PageHeader,
  Section,
  Stat,
  StatusBadge,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { useBankEntries, useTreasuryOverview } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { ReconcileModal } from './reconcile-modal';
import { TransferModal } from './transfer-modal';

/**
 * What we hold, where, and how much of it is somebody else's.
 *
 * The seller wallet answers "what do we OWE". It says nothing about
 * whether the cash exists. This page answers the other half, and the two
 * together answer the only question that really matters about client
 * money: are we covered.
 *
 * Every balance here is SUMMED from entries, never cached. The wallet
 * cached its balance and left the refresh to each caller; six of
 * fourteen money paths remembered, and a seller owing ₹3,000 read as
 * ₹0.00 on an admin page. Money read wrong is worse than money read
 * slowly.
 */
export function TreasuryIndex(): ReactElement {
  const canManage = usePermission('money.treasury.manage');
  const overview = useTreasuryOverview();
  const [transferring, setTransferring] = useState(false);
  const [reconciling, setReconciling] = useState<{
    id: string;
    label: string;
    currency: 'INR' | 'BDT';
    capital: string;
    bySeller: ReadonlyArray<{ sellerId: string; companyName: string; amount: string }>;
  } | null>(null);
  const [openAccount, setOpenAccount] = useState<string | null>(null);
  const entries = useBankEntries({ limit: 50 }, true);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Treasury"
        subtitle="Which account holds what, how much of it is ours, and whether what we owe sellers is covered."
        action={
          canManage ? (
            <Button size="sm" onClick={() => setTransferring(true)}>
              Move money
            </Button>
          ) : undefined
        }
      />

      {overview.isLoading ? (
        <LoadingState />
      ) : overview.isError || overview.data === undefined ? (
        <ErrorState
          message={overview.error?.message ?? 'Could not read the treasury.'}
          retry={() => void overview.refetch()}
        />
      ) : (
        <>
          {/* Client-money coverage first, because it is the one number
              on this page that can mean we are in trouble. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Owed to sellers"
              value={<Money amount={overview.data.clientMoney.owedToSellersInr} currency="INR" />}
              hint="Sum of positive wallet balances — what they could ask for"
              tone="warn"
            />
            <Stat
              label="Held for sellers"
              value={<Money amount={overview.data.clientMoney.heldForSellersInr} currency="INR" />}
              hint="Cash in our accounts marked as theirs"
            />
            {/* The label and the number have to describe the SAME thing.
                `gapInr` is owed − held, so it is zero or negative when
                healthy — labelling that "Covered" put the most alarming
                figure on screen in the good case ("Covered ₹0.00"), and
                a real surplus read as "Covered −₹5,000.00". Show the
                magnitude, and let the label say which direction it is. */}
            <Stat
              label={overview.data.clientMoney.covered ? 'Surplus held' : 'Shortfall'}
              value={
                <Money
                  amount={Math.abs(Number(overview.data.clientMoney.gapInr)).toFixed(2)}
                  currency="INR"
                />
              }
              hint={
                overview.data.clientMoney.covered
                  ? Number(overview.data.clientMoney.gapInr) === 0
                    ? 'Exactly covered — we hold what we owe, to the rupee'
                    : 'Held for sellers over and above what we owe them'
                  : 'We owe more than we hold — money in transit is a normal cause, but check'
              }
              tone={overview.data.clientMoney.covered ? 'good' : 'bad'}
            />
            {overview.data.totals.byCurrency.map((c) => (
              <Stat
                key={c.currency}
                label={`Total ${c.currency}`}
                value={<Money amount={c.total} currency={c.currency} convert={false} />}
                hint={`Ours ${c.capital} · held ${c.sellerHeld}`}
              />
            ))}
          </div>

          <Section
            title="Accounts"
            subtitle="Open one to see whose money is inside it. A balance is the sum of its entries, so it cannot lag behind them."
          >
            <Table>
              <THead>
                <Tr>
                  <Th>Account</Th>
                  <Th>Purpose</Th>
                  <Th>Settles from</Th>
                  <Th>Ours</Th>
                  <Th>Held for sellers</Th>
                  <Th>Total</Th>
                  <Th align="right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {overview.data.accounts.length === 0 ? (
                  <TableEmpty colSpan={7}>
                    No bank accounts yet. Add one on the Bank accounts page, with its opening
                    balance.
                  </TableEmpty>
                ) : (
                  overview.data.accounts.map((a) => (
                    <Tr key={a.accountId}>
                      <Td>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 text-left"
                          onClick={() =>
                            setOpenAccount(openAccount === a.accountId ? null : a.accountId)
                          }
                        >
                          {openAccount === a.accountId ? (
                            <ChevronDown size={14} aria-hidden />
                          ) : (
                            <ChevronRight size={14} aria-hidden />
                          )}
                          <span>
                            <span className="text-text-bright block">{a.label}</span>
                            <span className="text-text-faint text-xs">
                              {a.bankName} · {a.currency}
                            </span>
                          </span>
                        </button>
                        {openAccount === a.accountId && (
                          <div className="mt-2 pl-5">
                            {a.bySeller.length === 0 ? (
                              <p className="text-text-faint text-xs">
                                Nothing in here belongs to a seller.
                              </p>
                            ) : (
                              <dl className="space-y-1">
                                {a.bySeller.map((s) => (
                                  <div key={s.sellerId} className="flex justify-between gap-3">
                                    <dt className="text-text-muted text-xs">{s.companyName}</dt>
                                    <dd className="text-text-body text-xs">
                                      <Money
                                        amount={s.amount}
                                        currency={a.currency}
                                        convert={false}
                                      />
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            )}
                          </div>
                        )}
                      </Td>
                      <Td className="text-text-muted text-sm">{a.purpose ?? '—'}</Td>
                      <Td className="text-text-muted text-sm">{a.courierAccountLabel ?? '—'}</Td>
                      <Td>
                        <Money amount={a.capital} currency={a.currency} convert={false} />
                      </Td>
                      <Td>
                        <Money amount={a.sellerHeld} currency={a.currency} convert={false} />
                      </Td>
                      <Td>
                        <Money amount={a.total} currency={a.currency} convert={false} />
                      </Td>
                      <Td align="right">
                        {canManage ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setReconciling({
                                id: a.accountId,
                                label: a.label,
                                currency: a.currency,
                                capital: a.capital,
                                bySeller: a.bySeller,
                              })
                            }
                          >
                            Reconcile
                          </Button>
                        ) : (
                          <span className="text-text-faint">—</span>
                        )}
                      </Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </Section>

          <Section
            title="Recent movements"
            subtitle="Append-only. A correction is a new entry saying who corrected it and by how much — never an edit."
          >
            {entries.isError ? (
              <ErrorState
                message={entries.error?.message ?? 'Could not read the ledger.'}
                retry={() => void entries.refetch()}
              />
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>When</Th>
                    <Th>Account</Th>
                    <Th>What</Th>
                    <Th>Whose</Th>
                    <Th>Amount</Th>
                  </Tr>
                </THead>
                <TBody>
                  {(entries.data?.items ?? []).length === 0 ? (
                    <TableEmpty colSpan={5}>
                      Nothing recorded yet. Settlements, top-ups and payouts will appear here as
                      they are wired in.
                    </TableEmpty>
                  ) : (
                    (entries.data?.items ?? []).map((e) => (
                      <Tr key={e.id}>
                        <Td className="text-text-muted text-sm">
                          {new Date(e.occurredAt).toLocaleString()}
                        </Td>
                        <Td className="text-sm">{e.accountLabel}</Td>
                        <Td className="text-sm">
                          {e.type.replaceAll('_', ' ').toLowerCase()}
                          {e.categoryName !== null && (
                            <span className="text-text-faint"> · {e.categoryName}</span>
                          )}
                        </Td>
                        <Td className="text-text-muted text-sm">
                          {e.ownerKind === 'CAPITAL' ? 'Ours' : (e.sellerName ?? 'A seller')}
                        </Td>
                        <Td>
                          {/* Sign carries the direction, so a debit and a
                              credit cannot be told apart by colour alone. */}
                          <Money amount={e.signedAmount} currency={e.currency} convert={false} />
                        </Td>
                      </Tr>
                    ))
                  )}
                </TBody>
              </Table>
            )}
          </Section>

          {!overview.data.clientMoney.covered && (
            <Card>
              <CardBody>
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]"
                    aria-hidden
                  />
                  <p className="text-text-muted text-sm">
                    We owe sellers more than we are holding for them. That is not automatically
                    wrong — COD the courier has collected but not yet settled shows up exactly like
                    this — but it is the gap to be able to explain.
                  </p>
                </div>
              </CardBody>
            </Card>
          )}

          {overview.data.clientMoney.covered && overview.data.accounts.length > 0 && (
            <p className="text-text-faint inline-flex items-center gap-1.5 text-xs">
              <ShieldCheck size={14} aria-hidden />
              Client money is covered by what we hold.
            </p>
          )}

          <StatusBadge kind="draft" label="Phase 1B" />
        </>
      )}

      <TransferModal open={transferring} onOpenChange={setTransferring} />
      <ReconcileModal
        accountId={reconciling?.id ?? null}
        accountLabel={reconciling?.label ?? ''}
        currency={reconciling?.currency ?? 'INR'}
        bookBalance={reconciling?.capital ?? '0'}
        bySeller={reconciling?.bySeller ?? []}
        onClose={() => setReconciling(null)}
      />
    </div>
  );
}
