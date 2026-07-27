'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { AlertTriangle, Lock, Unlock } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  ErrorNote,
  Num,
  PageHeader,
  Section,
  Skeleton,
  Stat,
  StatusBadge,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { useDelhiveryStatus, useRefillWaybillPool } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * The Delhivery operations console.
 *
 * Three things that fail silently until they are expensive, on one
 * screen: how many AWBs are left, whether physical writes are permitted,
 * and how much rate budget remains before the WAF blocks our egress IP.
 */
export function DelhiveryOpsIndex(): ReactElement {
  const toast = useToast();
  const status = useDelhiveryStatus();
  const refill = useRefillWaybillPool();

  const pool = status.data?.waybillPool;
  const usable = pool?.usableNow ?? 0;
  const poolTone = usable === 0 ? 'bad' : usable < 50 ? 'warn' : 'good';

  async function doRefill(): Promise<void> {
    try {
      const result = await refill.mutateAsync();
      toast.success(
        result.fetched === 0
          ? `Pool is already above its watermark (${result.poolAfter} held).`
          : `Fetched ${result.fetched}. Pool now ${result.poolAfter}.`,
      );
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Delhivery"
        subtitle="Waybill pool depth, the live-write guard, and remaining rate budget. Refreshes every 30 seconds."
        action={
          <Button
            variant="secondary"
            size="md"
            disabled={refill.isPending}
            onClick={() => void doRefill()}
          >
            {refill.isPending ? 'Refilling…' : 'Refill waybill pool'}
          </Button>
        }
      />

      {status.isError ? (
        <ErrorNote
          message={status.error?.message ?? 'Could not read Delhivery status.'}
          retry={() => void status.refetch()}
        />
      ) : status.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <>
          {/* ── mode + guard ── */}
          <Section
            title="Connection"
            subtitle="Stub mode means no network call ever leaves this process. The write guard is a second, independent gate on operations with a physical or billable effect."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Card>
                <CardBody>
                  <div className="mb-1.5 flex items-center gap-2">
                    <StatusBadge
                      kind={status.data?.liveMode === true ? 'in-transit' : 'draft'}
                      label={status.data?.liveMode === true ? 'Live API' : 'Stub mode'}
                    />
                  </div>
                  <p className="text-text-muted text-xs leading-relaxed">
                    {status.data?.liveMode === true
                      ? 'Calls go to the real Delhivery API. There is no sandbox on this account, so every request counts against production.'
                      : 'No base URL configured, so the adapter answers from deterministic stubs. Safe to exercise any flow.'}
                  </p>
                </CardBody>
              </Card>

              <Card
                tone={status.data?.liveWritesEnabled === true ? 'critical' : 'default'}
              >
                <CardBody>
                  <div className="mb-1.5 flex items-center gap-2">
                    {status.data?.liveWritesEnabled === true ? (
                      <>
                        <Unlock
                          size={14}
                          className="text-[var(--color-critical)]"
                          aria-hidden
                        />
                        <span className="text-[var(--color-critical)] text-sm font-medium">
                          Live writes ENABLED
                        </span>
                      </>
                    ) : (
                      <>
                        <Lock size={14} className="text-text-muted" aria-hidden />
                        <span className="text-text-body text-sm font-medium">
                          Live writes blocked
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-text-muted text-xs leading-relaxed">
                    {status.data?.liveWritesEnabled === true
                      ? 'Manifesting, pickups, cancels and NDR actions will reach the real account. Turn this off again once the intended operation is done.'
                      : 'Manifesting, pickups, cancels and NDR actions are refused with DELHIVERY_LIVE_WRITES_DISABLED. This is the default and the safe state.'}
                  </p>
                  <Link
                    href="/settings"
                    className="text-accent mt-2 inline-block text-xs hover:underline"
                  >
                    Change in system settings →
                  </Link>
                </CardBody>
              </Card>
            </div>
          </Section>

          {/* ── waybill pool ── */}
          <Section
            title="Waybill pool"
            subtitle="AWBs are fetched in bulk ahead of time because Delhivery allows only five bulk requests per five minutes. An empty pool stops manifests."
          >
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Stat
                label="Usable now"
                value={<Num value={usable} />}
                tone={poolTone}
                hint="Past their settle delay"
              />
              <Stat
                label="Available"
                value={<Num value={pool?.available ?? 0} />}
                hint="Includes not-yet-settled"
              />
              <Stat label="Assigned" value={<Num value={pool?.assigned ?? 0} />} />
              <Stat label="Used" value={<Num value={pool?.used ?? 0} />} />
              <Stat label="Void" value={<Num value={pool?.void ?? 0} />} />
            </div>

            {usable === 0 && (
              <div
                role="alert"
                className="border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] mt-3 flex items-start gap-2 rounded-[var(--radius-2)] border px-3 py-2"
              >
                <AlertTriangle
                  size={14}
                  className="text-[var(--color-critical)] mt-0.5 shrink-0"
                  aria-hidden
                />
                <p className="text-[var(--color-critical)] text-xs leading-relaxed">
                  No usable waybills. Manifest closure will fail until the pool is
                  refilled. In live mode the refill itself needs the write guard on.
                </p>
              </div>
            )}
          </Section>

          {/* ── rate budget ── */}
          <Section
            title="Rate budget"
            subtitle="Budgeted to 80% of Delhivery's documented limits, per five-minute window, shared across every API instance. Exhausting one returns a WAF 403 that blocks our whole egress IP."
          >
            <Table>
              <THead>
                <Tr>
                  <Th>Endpoint</Th>
                  <Th align="right">Remaining</Th>
                  <Th align="right">Budget</Th>
                  <Th>Headroom</Th>
                </Tr>
              </THead>
              <TBody>
                {status.data?.rateBudgets.map((b) => {
                  const pct =
                    b.budget <= 0 ? 0 : Math.round((b.remaining / b.budget) * 100);
                  return (
                    <Tr key={b.endpoint}>
                      <Td>
                        <span className="text-text-body">
                          {b.endpoint.replaceAll('_', ' ')}
                        </span>
                        {b.endpoint === 'waybill_bulk' && (
                          <span className="text-text-faint ml-2 text-xs">
                            five per five minutes — the tight one
                          </span>
                        )}
                      </Td>
                      <Td align="right">
                        <Num value={b.remaining} />
                      </Td>
                      <Td align="right" className="text-text-muted">
                        <Num value={b.budget} />
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div
                            className="bg-surface-hover h-1.5 w-24 overflow-hidden rounded-full"
                            aria-hidden
                          >
                            <div
                              className="h-full"
                              style={{
                                width: `${pct}%`,
                                background:
                                  pct < 20
                                    ? 'var(--color-critical)'
                                    : pct < 50
                                      ? 'var(--status-pending-fg)'
                                      : 'var(--status-delivered-fg)',
                              }}
                            />
                          </div>
                          <span className="text-text-muted skydrop-tabular text-xs">
                            {pct}%
                          </span>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </Section>
        </>
      )}
    </div>
  );
}
