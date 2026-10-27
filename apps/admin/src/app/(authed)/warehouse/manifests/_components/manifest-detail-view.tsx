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
import { useT, useLocale } from '@/i18n/client';

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
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const detail = useManifestDetail(id);
  const close = useCloseManifest();
  const handoff = useConfirmHandoff();

  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showHandoffConfirm, setShowHandoffConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fmtError(err: unknown): string {
    return serverVerdict(err, t('warehouseManifestsManifestDetailView.actionFailed'));
  }

  if (detail.isLoading)
    return (
      <SkeletonRows rows={6} label={t('warehouseManifestsManifestDetailView.loadingManifest')} />
    );
  if (detail.isError)
    return (
      <ErrorState
        message={serverVerdict(
          detail.error,
          t('warehouseManifestsManifestDetailView.failedToLoad'),
        )}
        retry={() => void detail.refetch()}
      />
    );
  if (!detail.data)
    return (
      <EmptyState
        title={t('warehouseManifestsManifestDetailView.manifestNotFound')}
        description={t('warehouseManifestsManifestDetailView.theManifestMayHaveBeen')}
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
          t('warehouseManifestsManifestDetailView.closedShipmentSQueuedFor', {
            manifestNumber: m.manifestNumber,
            transitionedCount: r.transitionedCount,
          }),
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
          t('warehouseManifestsManifestDetailView.dispatchedShipmentSHandedOff', {
            manifestNumber: m.manifestNumber,
            dispatchedShipmentIdsLength: r.dispatchedShipmentIds.length,
          }),
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
          { label: t('warehouseManifestsManifestDetailView.warehouse'), href: '/warehouse' },
          {
            label: t('warehouseManifestsManifestDetailView.manifests'),
            href: '/warehouse/manifests',
          },
          { label: m.manifestNumber },
        ]}
        title={t('warehouseManifestsManifestDetailView.manifest', {
          manifestNumber: m.manifestNumber,
        })}
        subtitle={t('warehouseManifestsManifestDetailView.shipmentS', {
          courierCode: m.courierCode,
          status: m.status,
          shipmentCount: m.shipmentCount,
        })}
        meta={<StatusChip kind="neutral" label={m.status.replace(/_/g, ' ')} />}
        action={
          <Actions>
            {isDraft && (
              <AsyncButton
                variant="primary"
                size="md"
                icon={<PackageCheck size={16} />}
                state={mutationPhase(close)}
                labels={{
                  idle: t('warehouseManifestsManifestDetailView.closeManifest'),
                  busy: t('warehouseManifestsManifestDetailView.closing'),
                }}
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
                labels={{
                  idle: t('warehouseManifestsManifestDetailView.confirmHandoff'),
                  busy: t('warehouseManifestsManifestDetailView.confirming'),
                }}
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
            {
              label: t('warehouseManifestsManifestDetailView.created'),
              value: new Date(m.createdAt).toLocaleString(),
            },
            {
              label: t('warehouseManifestsManifestDetailView.closed'),
              value: m.closedAt ? new Date(m.closedAt).toLocaleString() : '—',
            },
            { label: t('warehouseManifestsManifestDetailView.status'), value: m.status },
            { label: t('warehouseManifestsManifestDetailView.courier'), value: m.courierCode },
          ]}
        />
      </Panel>

      <AreaSection title={t('warehouseManifestsManifestDetailView.shipments')}>
        {m.shipments.length === 0 ? (
          <EmptyState
            title={t('warehouseManifestsManifestDetailView.noShipmentsAttached')}
            description={t('warehouseManifestsManifestDetailView.draftManifestsAreAutoPopulated')}
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t('warehouseManifestsManifestDetailView.shipment')}</Th>
                <Th>{t('warehouseManifestsManifestDetailView.status')}</Th>
                <Th>{t('warehouseManifestsManifestDetailView.order')}</Th>
                <Th>{t('warehouseManifestsManifestDetailView.packed')}</Th>
              </Tr>
            </THead>
            <TBody>
              {m.shipments.map((s) => (
                <Tr key={s.id} onActivate={() => router.push(`/orders/${s.orderId}`)}>
                  <Td className="sk-ident">
                    {/* The row pushes to the order on click; this is the
                        same destination as a real link, so a keyboard can
                        reach it too. */}
                    <Link href={`/orders/${s.orderId}`} className="af-link">
                      {s.shipmentNumber}
                    </Link>
                  </Td>
                  <Td>
                    <StatusChip
                      size="sm"
                      kind={shipmentStatusKind(s.status)}
                      label={statusLabel(s.status, locale)}
                    />
                  </Td>
                  <Td>
                    {s.orderId ? (
                      <TextLink href={`/orders/${s.orderId}`}>
                        {t('warehouseManifestsManifestDetailView.viewOrder')}
                      </TextLink>
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
        title={t('warehouseManifestsManifestDetailView.closeManifest2', {
          manifestNumber: m.manifestNumber,
        })}
        entity={t('warehouseManifestsManifestDetailView.shipmentS2', {
          manifestNumber: m.manifestNumber,
          shipmentCount: m.shipmentCount,
        })}
        entityIsIdentifier
        consequence={t('warehouseManifestsManifestDetailView.thisTransitionsTheManifestTo')}
        confirmLabel={t('warehouseManifestsManifestDetailView.closeManifest')}
        closeOnSuccess={false}
        error={error}
        onConfirm={onClose}
      />
      <ConfirmDialog
        open={showHandoffConfirm}
        onOpenChange={setShowHandoffConfirm}
        title={t('warehouseManifestsManifestDetailView.confirmHandoffFor', {
          manifestNumber: m.manifestNumber,
        })}
        entity={`${m.manifestNumber} · ${m.courierCode}`}
        entityIsIdentifier
        consequence={t('warehouseManifestsManifestDetailView.thisMarksEveryAwbReady')}
        confirmLabel={t('warehouseManifestsManifestDetailView.confirmHandoff')}
        closeOnSuccess={false}
        error={error}
        onConfirm={onHandoff}
      />
    </AreaPage>
  );
}
