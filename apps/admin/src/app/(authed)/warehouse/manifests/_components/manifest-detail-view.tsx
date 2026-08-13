'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import { useCloseManifest, useConfirmHandoff, useManifestDetail } from '@/lib/api-hooks';
import { MoveShipmentPanel } from './move-shipment-panel';
import { useRouter } from 'next/navigation';

/**
 * Manifest detail — shows the manifest header, the list of shipments
 * attached, and the lifecycle action available at each state:
 *   - DRAFT → "Close manifest" (CLOSED + triggers AWB generation)
 *   - CONFIRMED → "Confirm handoff" (DISPATCHED + driver receipt)
 *   - DISPATCHED / FAILED → read-only
 *
 * FE-2: server-verdict surfacing on every action.
 */
export function ManifestDetailView({ id }: { readonly id: string }): ReactElement {
  const router = useRouter();
  const toast = useToast();
  const detail = useManifestDetail(id);
  const close = useCloseManifest();
  const handoff = useConfirmHandoff();

  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showHandoffConfirm, setShowHandoffConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fmtError(err: unknown): string {
    if (err instanceof ApiError) {
      const b = err.body as { code?: unknown; message?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code : null;
      const msg = typeof b?.message === 'string' ? b.message : err.message;
      return code ? `[${code}] ${msg}` : msg;
    }
    return err instanceof Error ? err.message : 'Action failed';
  }

  if (detail.isLoading) return <LoadingState label="Loading manifest…" />;
  if (detail.isError) return <ErrorState message={detail.error?.message ?? 'Failed to load.'} />;
  if (!detail.data)
    return (
      <EmptyState
        title="Manifest not found"
        description="The manifest may have been deleted or the link is wrong."
      />
    );

  const m = detail.data;
  const isDraft = m.status === 'DRAFT';
  const isConfirmed = m.status === 'CONFIRMED';

  async function onClose(): Promise<void> {
    setError(null);
    try {
      const r = await close.mutateAsync({ manifestId: id });
      setShowCloseConfirm(false);
      if (r.failures.length === 0) {
        toast.success(
          `Closed ${m.manifestNumber} — ${r.transitionedCount} shipment(s) queued for AWB.`,
        );
      } else {
        toast.error(`Closed with ${r.failures.length} failure(s). See manifest detail.`);
      }
    } catch (err) {
      setError(fmtError(err));
    }
  }

  async function onHandoff(): Promise<void> {
    setError(null);
    try {
      const r = await handoff.mutateAsync({ manifestId: id });
      setShowHandoffConfirm(false);
      if (r.failures.length === 0) {
        toast.success(
          `Dispatched ${m.manifestNumber} — ${r.dispatchedShipmentIds.length} shipment(s) handed off.`,
        );
      } else {
        toast.error(`Handoff partial: ${r.failures.length} failed.`);
      }
    } catch (err) {
      setError(fmtError(err));
    }
  }

  return (
    <div>
      <PageHeader
        title={`Manifest ${m.manifestNumber}`}
        subtitle={`${m.courierCode} · ${m.status} · ${m.shipmentCount} shipment(s)`}
        action={
          <div className="flex items-center gap-2">
            {isDraft && (
              <Button
                variant="primary"
                size="md"
                disabled={close.isPending}
                onClick={() => setShowCloseConfirm(true)}
              >
                Close manifest
              </Button>
            )}
            {isConfirmed && (
              <Button
                variant="primary"
                size="md"
                disabled={handoff.isPending}
                onClick={() => setShowHandoffConfirm(true)}
              >
                Confirm handoff
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px] mb-3">
          {error}
        </div>
      )}

      <Card>
        <CardBody>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Field label="Created" value={new Date(m.createdAt).toLocaleString()} />
            <Field
              label="Closed"
              value={m.closedAt ? new Date(m.closedAt).toLocaleString() : '—'}
            />
            <Field label="Status" value={m.status} />
            <Field label="Courier" value={m.courierCode} />
          </div>
        </CardBody>
      </Card>

      <h2 className="text-text-bright text-sm font-medium mt-5 mb-2">Shipments</h2>
      {m.shipments.length === 0 ? (
        <EmptyState
          title="No shipments attached"
          description="DRAFT manifests are auto-populated as packers complete shipments for this courier + warehouse."
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Shipment</Th>
              <Th>Status</Th>
              <Th>Order</Th>
              <Th>Packed</Th>
            </Tr>
          </THead>
          <TBody>
            {m.shipments.map((s) => (
              <Tr key={s.id} onActivate={() => router.push(`/orders/${s.orderId}`)}>
                <Td className="font-mono text-xs">{s.shipmentNumber}</Td>
                <Td className="text-text-muted text-xs uppercase">{s.status}</Td>
                <Td>
                  {s.orderId ? (
                    <Link href={`/orders/${s.orderId}`} className="text-accent hover:underline">
                      view order
                    </Link>
                  ) : (
                    <span className="text-text-faint">—</span>
                  )}
                </Td>
                <Td className="text-text-muted text-xs font-mono">
                  {s.packCompletedAt ? new Date(s.packCompletedAt).toLocaleString() : '—'}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      <MoveShipmentPanel
        manifestId={m.id}
        manifestNumber={m.manifestNumber}
        status={m.status}
        courierCode={m.courierCode}
        originWarehouseId={m.originWarehouseId}
        shipments={m.shipments}
      />

      <ConfirmDialog
        open={showCloseConfirm}
        onOpenChange={setShowCloseConfirm}
        title={`Close manifest ${m.manifestNumber}?`}
        description="This transitions the manifest to CLOSED and queues AWB generation for every attached shipment. Cannot be undone."
        confirmLabel={close.isPending ? 'Closing…' : 'Close manifest'}
        confirmVariant="primary"
        disabled={close.isPending}
        onConfirm={onClose}
      />
      <ConfirmDialog
        open={showHandoffConfirm}
        onOpenChange={setShowHandoffConfirm}
        title={`Confirm handoff for ${m.manifestNumber}?`}
        description="This marks every AWB-ready shipment DISPATCHED, stamps the manifest DISPATCHED, and decrements warehouse stock (CUR-3). Run only after the courier driver has accepted the consolidated handoff."
        confirmLabel={handoff.isPending ? 'Confirming…' : 'Confirm handoff'}
        confirmVariant="primary"
        disabled={handoff.isPending}
        onConfirm={onHandoff}
      />
    </div>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string }): ReactElement {
  return (
    <div>
      <div className="text-text-faint text-xs uppercase tracking-wide">{label}</div>
      <div className="text-text-body mt-0.5 font-mono">{value}</div>
    </div>
  );
}
