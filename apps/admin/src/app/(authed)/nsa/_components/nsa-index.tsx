'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  FormField,
  Ident,
  Modal,
  ModalFooter,
  Money,
  PageHeader,
  SkeletonRows,
  Stat,
  Table,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Toolbar,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { AlertTriangle } from 'lucide-react';
import { useAcknowledgeNsa, useNsaList, useRunNsaSweep, type NsaOrderView } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';

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

  const rows = list.data ?? [];
  const worst = rows.filter((r) => r.dayCount >= 3).length;
  const unclaimed = rows.filter((r) => r.acknowledgedAt === null).length;

  async function submitAck(): Promise<void> {
    if (acking === null) return;
    setError(null);
    try {
      await ack.mutateAsync({
        orderId: acking.orderId,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      toast.success(`${acking.orderNumber} — noted as being chased`);
      setAcking(null);
      setNote('');
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <div>
      <PageHeader
        title="Needs attention"
        subtitle="Parcels that went out for delivery and were still out at the evening cutoff. The courier has not said why — somebody has to ask them."
        action={
          mayAct ? (
            <Button
              variant="secondary"
              size="md"
              disabled={sweep.isPending}
              onClick={() => {
                sweep.mutate(undefined, {
                  onSuccess: (s) =>
                    toast.success(
                      `Checked ${s.examined} — ${s.raised} newly flagged, ${s.escalated} escalated, ${s.cleared} moved on`,
                    ),
                  onError: (e) => toast.error(serverVerdict(e)),
                });
              }}
            >
              {sweep.isPending ? 'Checking…' : 'Check now'}
            </Button>
          ) : null
        }
      />

      {rows.length > 0 && (
        <Toolbar>
          <Stat label="Stuck parcels" value={String(rows.length)} />
          {/* Nobody has picked these up yet — the ones to start on. */}
          <Stat
            label="Nobody chasing"
            value={String(unclaimed)}
            tone={unclaimed > 0 ? 'warn' : 'neutral'}
          />
          <Stat
            label="Third night or worse"
            value={String(worst)}
            tone={worst > 0 ? 'bad' : 'neutral'}
          />
        </Toolbar>
      )}

      {list.isLoading ? (
        <Card>
          <SkeletonRows rows={5} />
        </Card>
      ) : list.isError ? (
        <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing is stuck"
          description="Every parcel that went out for delivery has either arrived or been scanned as failed. This list fills after the evening cutoff, so it is normally empty during the day."
        />
      ) : (
        <Card>
          <Table>
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
                    <span
                      className={
                        r.dayCount >= 3
                          ? 'text-[var(--color-critical)] font-medium'
                          : r.dayCount === 2
                            ? 'text-[var(--color-warning)]'
                            : 'text-text-body'
                      }
                    >
                      {r.dayCount === 1 ? '1st' : r.dayCount === 2 ? '2nd' : `${r.dayCount}rd+`}
                    </span>
                  </Td>
                  <Td>
                    <Link
                      href={`/orders/${r.orderId}`}
                      className="text-accent hover:underline font-mono text-xs"
                    >
                      {r.orderNumber}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/sellers/${r.sellerId}`} className="text-accent hover:underline">
                      {r.sellerName ?? <Ident value={`${r.sellerId.slice(0, 8)}…`} />}
                    </Link>
                  </Td>
                  <Td>
                    <div className="text-text-bright">{r.recipientName}</div>
                    {/* The phone is here rather than a click away: the
                        action this page exists for is a phone call. */}
                    <div className="text-text-faint text-xs">
                      {r.recipientCity} · {r.recipientPhoneE164}
                    </div>
                  </Td>
                  <Td>
                    {r.awbNumber === null ? (
                      <span className="text-text-faint text-xs">—</span>
                    ) : (
                      <div>
                        <Ident value={r.awbNumber} />
                        <div className="text-text-faint text-xs">{r.courierCode}</div>
                      </div>
                    )}
                  </Td>
                  <Td align="right">
                    {r.codAmountInr === null ? (
                      <span className="text-text-faint text-xs">—</span>
                    ) : (
                      <Money amount={r.codAmountInr} currency="INR" />
                    )}
                  </Td>
                  <Td>
                    {r.acknowledgedAt === null ? (
                      <span className="text-[var(--color-warning)] text-xs">nobody yet</span>
                    ) : (
                      <div className="text-xs">
                        <div className="text-text-body">
                          {new Date(r.acknowledgedAt).toLocaleString()}
                        </div>
                        {r.note !== null && <div className="text-text-faint">{r.note}</div>}
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
        </Card>
      )}

      <Modal
        open={acking !== null}
        onOpenChange={(o) => {
          if (!o) setAcking(null);
        }}
        title={`Chasing ${acking?.orderNumber ?? ''}`}
        description="Recorded so nobody else rings the same courier about the same parcel. It does not clear the flag — only the parcel moving does that."
      >
        <div className="flex items-start gap-2 text-xs text-text-muted">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            The parcel stays on this list until it is delivered, scanned as failed, or returned.
          </p>
        </div>
        <FormField
          label="What you found"
          hint="Optional — what the courier said, or what you are waiting on."
        >
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
          />
        </FormField>
        {error !== null && <ErrorNote message={error} />}
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => setAcking(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={ack.isPending}
            onClick={() => void submitAck()}
          >
            {ack.isPending ? 'Saving…' : 'Save'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
