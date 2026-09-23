'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { PackageCheck, Truck } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { useToast } from '@skydrop/ui/app/toast';
import { shipmentStatusKind, statusLabel } from '@skydrop/ui/status';
import {
  Actions,
  AreaPage,
  AreaSection,
  Facts,
  InlineError,
  Panel,
  TextLink,
  mutationPhase,
} from '../../../inventory/_components/stock-kit';
import { useCloseManifest, useConfirmHandoff, useManifestDetail } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
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
    return serverVerdict(err, 'Action failed');
  }

  if (detail.isLoading) return <SkeletonRows rows={6} label="Loading manifest…" />;
  if (detail.isError)
    return (
      <ErrorState
        message={serverVerdict(detail.error, 'Failed to load.')}
        retry={() => void detail.refetch()}
      />
    );
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
    <AreaPage>
      <PageHeader
        Link={Link}
        breadcrumbs={[
          { label: 'Warehouse', href: '/warehouse' },
          { label: 'Manifests', href: '/warehouse/manifests' },
          { label: m.manifestNumber },
        ]}
        title={`Manifest ${m.manifestNumber}`}
        subtitle={`${m.courierCode} · ${m.status} · ${m.shipmentCount} shipment(s)`}
        meta={<StatusChip kind="neutral" label={m.status.replace(/_/g, ' ')} />}
        action={
          <Actions>
            {isDraft && (
              <AsyncButton
                variant="primary"
                size="md"
                icon={<PackageCheck size={16} />}
                state={mutationPhase(close)}
                labels={{ idle: 'Close manifest', busy: 'Closing…' }}
                disabled={close.isPending}
                onClick={() => setShowCloseConfirm(true)}
              />
            )}
            {isConfirmed && (
              <AsyncButton
                variant="primary"
                size="md"
                icon={<Truck size={16} />}
                state={mutationPhase(handoff)}
                labels={{ idle: 'Confirm handoff', busy: 'Confirming…' }}
                disabled={handoff.isPending}
                onClick={() => setShowHandoffConfirm(true)}
              />
            )}
          </Actions>
        }
      />

      {error && <InlineError message={error} />}

      <Panel>
        <Facts
          columns={4}
          items={[
            { label: 'Created', value: new Date(m.createdAt).toLocaleString() },
            { label: 'Closed', value: m.closedAt ? new Date(m.closedAt).toLocaleString() : '—' },
            { label: 'Status', value: m.status },
            { label: 'Courier', value: m.courierCode },
          ]}
        />
      </Panel>

      <AreaSection title="Shipments">
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
                  <Td className="sk-ident">{s.shipmentNumber}</Td>
                  <Td>
                    <StatusChip
                      size="sm"
                      kind={shipmentStatusKind(s.status)}
                      label={statusLabel(s.status)}
                    />
                  </Td>
                  <Td>
                    {s.orderId ? (
                      <TextLink href={`/orders/${s.orderId}`}>view order</TextLink>
                    ) : (
                      <span className="stk-faint">—</span>
                    )}
                  </Td>
                  <Td className="stk-muted sk-figure stk-nowrap">
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
      </AreaSection>

      <ConfirmDialog
        open={showCloseConfirm}
        onOpenChange={setShowCloseConfirm}
        title={`Close manifest ${m.manifestNumber}?`}
        entity={`${m.manifestNumber} · ${m.shipmentCount} shipment(s)`}
        entityIsIdentifier
        consequence="This transitions the manifest to CLOSED and queues AWB generation for every attached shipment. Cannot be undone."
        confirmLabel="Close manifest"
        closeOnSuccess={false}
        error={error}
        onConfirm={onClose}
      />
      <ConfirmDialog
        open={showHandoffConfirm}
        onOpenChange={setShowHandoffConfirm}
        title={`Confirm handoff for ${m.manifestNumber}?`}
        entity={`${m.manifestNumber} · ${m.courierCode}`}
        entityIsIdentifier
        consequence="This marks every AWB-ready shipment DISPATCHED, stamps the manifest DISPATCHED, and decrements warehouse stock (CUR-3). Run only after the courier driver has accepted the consolidated handoff."
        confirmLabel="Confirm handoff"
        closeOnSuccess={false}
        error={error}
        onConfirm={onHandoff}
      />
    </AreaPage>
  );
}
