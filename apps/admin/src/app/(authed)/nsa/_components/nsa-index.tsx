'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { AlertTriangle, CircleCheck, PhoneOutgoing, RefreshCw, UserX } from 'lucide-react';
import { Ident, Money } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TextArea } from '@skydrop/ui/app/text-field';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { useToast } from '@skydrop/ui/app/toast';
import { useAcknowledgeNsa, useNsaList, useRunNsaSweep, type NsaOrderView } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { AgeChip, Notice, OoSection } from '../../orders/_components/order-ops-parts';

/**
 * OUR side of the NSA worklist.
 *
 * ── WHAT THESE ARE ───────────────────────────────────────────────────
 * Parcels that went out for delivery and were still out for delivery
 * when the evening came. The courier has said nothing — no NDR, no
 * failed-delivery scan — so unlike a failed delivery, nobody finds out
 * what happened unless a person asks. That is the whole job of this
 * page: ring the courier.
 *
 * ── WHY IT IS NOT THE SELLER'S PAGE ──────────────────────────────────
 * Same flag, different job. We work every seller's at once and need to
 * see who is already chasing which, because two people ringing the same
 * courier about the same parcel is the obvious failure of a shared
 * list. The seller sees only their own and is deciding whether to chase
 * US. One page serving both would serve neither.
 *
 * ── WHAT ACKNOWLEDGING DOES ──────────────────────────────────────────
 * It records that somebody is on it. It does NOT clear the flag — the
 * parcel is still stuck, and the only thing that un-sticks it is the
 * parcel moving. A button that made the row disappear would turn "I am
 * looking into this" into "this is handled", which are not the same
 * sentence.
 */
export function NsaIndex(): ReactElement {
  const mayAct = usePermission('orders.tracking.manual_scan');
  const list = useNsaList(usePermission('orders.view'));
  const ack = useAcknowledgeNsa();
  const sweep = useRunNsaSweep();
  const toast = useToast();
  const [acking, setAcking] = useState<NsaOrderView | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sweepOpen, setSweepOpen] = useState(false);
  const [sweepError, setSweepError] = useState<string | null>(null);

  const rows = list.data ?? [];
  const worst = rows.filter((r) => r.dayCount >= 3).length;
  const unclaimed = rows.filter((r) => r.acknowledgedAt === null).length;

  /** Resolves true when saved; false when refused (the verdict is in `error`). */
  async function submitAck(): Promise<boolean> {
    if (acking === null) return false;
    setError(null);
    try {
      await ack.mutateAsync({
        orderId: acking.orderId,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      toast.success(`${acking.orderNumber} — noted as being chased`);
      setAcking(null);
      setNote('');
      return true;
    } catch (err) {
      setError(serverVerdict(err));
      return false;
    }
  }

  return (
    <div className="oo-page">
      <PageHeader
        title="Needs attention"
        subtitle="Parcels that went out for delivery and were still out at the evening cutoff. The courier has not said why — somebody has to ask them."
        action={
          mayAct ? (
            <Button
              variant="secondary"
              size="md"
              icon={<RefreshCw size={15} />}
              disabled={sweep.isPending}
              onClick={() => {
                setSweepError(null);
                setSweepOpen(true);
              }}
            >
              {sweep.isPending ? 'Checking…' : 'Check now'}
            </Button>
          ) : null
        }
      />

      {rows.length > 0 && (
        <div className="oo-kpis">
          <KpiCard
            label="Stuck parcels"
            icon={<AlertTriangle size={14} />}
            tone="neutral"
            value={rows.length}
          />
          {/* Nobody has picked these up yet — the ones to start on. */}
          <KpiCard
            label="Nobody chasing"
            icon={<UserX size={14} />}
            tone={unclaimed > 0 ? 'pending' : 'neutral'}
            value={unclaimed}
          />
          <KpiCard
            label="Third night or worse"
            icon={<PhoneOutgoing size={14} />}
            tone={worst > 0 ? 'debit' : 'neutral'}
            value={worst}
          />
        </div>
      )}

      {list.isLoading ? (
        <SkeletonRows rows={5} cols={8} label="Loading stuck parcels…" />
      ) : list.isError ? (
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          tone="positive"
          icon={<CircleCheck size={20} />}
          title="Nothing is stuck"
          description="Every parcel that went out for delivery has either arrived or been scanned as failed. This list fills after the evening cutoff, so it is normally empty during the day."
        />
      ) : (
        <OoSection title="Stuck parcels" note={`${rows.length} to chase`} flush>
          <Table caption="Parcels still out for delivery after the evening cutoff">
            <THead>
              <Tr>
                <Th>Night</Th>
                <Th>Order</Th>
                <Th>Seller</Th>
                <Th>Recipient</Th>
                <Th>AWB</Th>
                <Th align="right">COD</Th>
                <Th>Being chased</Th>
                <Th align="right" />
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.orderId}>
                  <Td>
                    <AgeChip
                      tone={r.dayCount >= 3 ? 'late' : r.dayCount === 2 ? 'aging' : 'neutral'}
                    >
                      {r.dayCount === 1 ? '1st' : r.dayCount === 2 ? '2nd' : `${r.dayCount}rd+`}
                    </AgeChip>
                  </Td>
                  <Td>
                    <Link href={`/orders/${r.orderId}`} className="oo-link sk-ident">
                      {r.orderNumber}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/sellers/${r.sellerId}`} className="oo-link">
                      {r.sellerName ?? <Ident value={`${r.sellerId.slice(0, 8)}…`} />}
                    </Link>
                  </Td>
                  <Td>
                    <span className="oo-strong">{r.recipientName}</span>
                    {/* The phone is here rather than a click away: the
                        action this page exists for is a phone call. */}
                    <span className="oo-sub">
                      {r.recipientCity} · {r.recipientPhoneE164}
                    </span>
                  </Td>
                  <Td>
                    {r.awbNumber === null ? (
                      <span className="oo-faint">—</span>
                    ) : (
                      <div>
                        <Ident value={r.awbNumber} />
                        <span className="oo-sub">{r.courierCode}</span>
                      </div>
                    )}
                  </Td>
                  <Td align="right">
                    {r.codAmountInr === null ? (
                      <span className="oo-faint">—</span>
                    ) : (
                      <Money amount={r.codAmountInr} currency="INR" />
                    )}
                  </Td>
                  <Td>
                    {r.acknowledgedAt === null ? (
                      <StatusChip size="sm" kind="pending" label="nobody yet" />
                    ) : (
                      <div>
                        <span className="oo-muted">
                          {new Date(r.acknowledgedAt).toLocaleString()}
                        </span>
                        {r.note !== null && <span className="oo-sub">{r.note}</span>}
                      </div>
                    )}
                  </Td>
                  <Td align="right">
                    {mayAct && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setAcking(r);
                          setNote(r.note ?? '');
                          setError(null);
                        }}
                      >
                        {r.acknowledgedAt === null ? "I'm on it" : 'Update note'}
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </OoSection>
      )}

      <ConfirmDialog
        open={sweepOpen}
        onOpenChange={(o) => {
          setSweepOpen(o);
          if (!o) setSweepError(null);
        }}
        title="Check for stuck parcels now?"
        entity="Every parcel still out for delivery"
        consequence="Runs the evening check straight away: parcels still out for delivery are flagged or escalated here, and any that have moved on come off the list."
        confirmLabel="Check now"
        error={sweepError ?? undefined}
        onConfirm={async () => {
          setSweepError(null);
          try {
            const s = await sweep.mutateAsync(undefined);
            toast.success(
              `Checked ${s.examined} — ${s.raised} newly flagged, ${s.escalated} escalated, ${s.cleared} moved on`,
            );
          } catch (e) {
            const verdict = serverVerdict(e);
            setSweepError(verdict);
            toast.error(verdict);
            throw e;
          }
        }}
      />

      <Dialog
        open={acking !== null}
        onOpenChange={(o) => {
          if (!o) setAcking(null);
        }}
        title={`Chasing ${acking?.orderNumber ?? ''}`}
        description="Recorded so nobody else rings the same courier about the same parcel. It does not clear the flag — only the parcel moving does that."
        footer={
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setAcking(null)}>
              Cancel
            </Button>
            <AsyncButton
              variant="primary"
              size="sm"
              labels={{ idle: 'Save', busy: 'Saving…' }}
              onAction={async () => {
                const ok = await submitAck();
                if (!ok) throw new Error('refused');
              }}
            />
          </DialogFooter>
        }
      >
        <div className="oo-stack">
          <Notice icon={<AlertTriangle size={16} />}>
            <p>
              The parcel stays on this list until it is delivered, scanned as failed, or returned.
            </p>
          </Notice>
          <TextArea
            label="What you found"
            hint="Optional — what the courier said, or what you are waiting on."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            showCount
          />
          {error !== null && (
            <p className="oo-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
