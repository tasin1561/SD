'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { AlertTriangle, Truck } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TextArea } from '@skydrop/ui/app/text-field';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import {
  useDecideDeliveryAction,
  useDeliveryActionQueue,
  type AdminDeliveryActionView,
} from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import {
  AgeChip,
  Notice,
  OoCard,
  OoSection,
  elapsedSince,
} from '../../orders/_components/order-ops-parts';
import { useT } from '@/i18n/client';

/**
 * The operator gate for failed deliveries (CUR-10).
 *
 * A seller has asked us to do something about a parcel that could not be
 * delivered. Approving a re-attempt dispatches a van; approving an RTO
 * turns a moving parcel into a return. Neither may be fired by a
 * seller-facing handler, which is the entire reason this queue exists —
 * a person decides, and the decision is recorded with its reason.
 *
 * RECALL is the exception and is worth recognising on sight: it asks our
 * own agents to phone the customer and reaches no courier at all.
 */
function actionLabel(a: AdminDeliveryActionView['action']): string {
  switch (a) {
    case 'REATTEMPT':
      return 'Re-attempt delivery';
    case 'RECALL':
      return 'Call the customer';
    case 'RTO':
      return 'Return to us';
  }
}

function statusKind(
  s: AdminDeliveryActionView['status'],
): 'pending' | 'confirmed' | 'failed' | 'cancelled' {
  switch (s) {
    case 'PENDING':
    case 'APPROVED':
      return 'pending';
    case 'EXECUTED':
      return 'confirmed';
    case 'FAILED':
      return 'failed';
    case 'REJECTED':
    case 'EXPIRED':
      return 'cancelled';
  }
}

export function DeliveryActionsIndex(): ReactElement {
  const t = useT();
  const canDecide = usePermission('courier.ops.write');
  const [showAll, setShowAll] = useState(false);
  const queue = useDeliveryActionQueue(showAll ? undefined : 'PENDING');
  const decide = useDecideDeliveryAction();

  const [deciding, setDeciding] = useState<{
    row: AdminDeliveryActionView;
    decision: 'approve' | 'reject';
  } | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  /** Resolves true when the decision landed; false when refused (the reason is in `error`). */
  async function submit(): Promise<boolean> {
    if (deciding === null) return false;
    setError(null);
    if (deciding.decision === 'reject' && note.trim().length < 5) {
      setError(t('deliveryActionsDeliveryActionsIndex.sayWhyTheClientSees'));
      return false;
    }
    try {
      await decide.mutateAsync({
        requestId: deciding.row.id,
        decision: deciding.decision,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      setNote('');
      setDeciding(null);
      return true;
    } catch (err) {
      setError(serverVerdict(err));
      return false;
    }
  }

  const rows = queue.data ?? [];

  return (
    <div className="oo-page">
      <PageHeader
        title={t('deliveryActionsDeliveryActionsIndex.failedDeliveries')}
        subtitle={t('deliveryActionsDeliveryActionsIndex.whatClientsHaveAskedUs')}
      />

      <OoCard>
        <Checkbox
          checked={showAll}
          onChange={(e) => setShowAll(e.target.checked)}
          label={t('deliveryActionsDeliveryActionsIndex.showDecidedRequestsToo')}
          description={t('deliveryActionsDeliveryActionsIndex.approvingAReAttemptSends')}
        />
      </OoCard>

      <OoSection
        title={
          showAll
            ? t('deliveryActionsDeliveryActionsIndex.allRequests')
            : t('deliveryActionsDeliveryActionsIndex.waitingOnADecision')
        }
        note={queue.data === undefined ? undefined : `${rows.length} shown`}
        flush
      >
        {queue.isLoading ? (
          <div className="oo-card__pad">
            <SkeletonRows
              rows={4}
              cols={6}
              label={t('deliveryActionsDeliveryActionsIndex.loadingTheQueue')}
            />
          </div>
        ) : queue.isError || queue.data === undefined ? (
          <div className="oo-card__pad">
            <ErrorState
              message={
                queue.error?.message ??
                t('deliveryActionsDeliveryActionsIndex.couldNotReadTheQueue')
              }
              retry={() => void queue.refetch()}
            />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            bare
            tone={showAll ? 'neutral' : 'positive'}
            icon={<Truck size={20} />}
            title={
              showAll
                ? t('deliveryActionsDeliveryActionsIndex.noRequestsYet')
                : t('deliveryActionsDeliveryActionsIndex.nothingWaiting')
            }
            description={
              showAll
                ? t('deliveryActionsDeliveryActionsIndex.noClientHasAskedFor')
                : t('deliveryActionsDeliveryActionsIndex.nothingWaitingFailedDeliveriesAppear')
            }
          />
        ) : (
          <Table caption={t('deliveryActionsDeliveryActionsIndex.failedDeliveryRequests')}>
            <THead>
              <Tr>
                <Th>{t('deliveryActionsDeliveryActionsIndex.order')}</Th>
                <Th>{t('deliveryActionsDeliveryActionsIndex.client')}</Th>
                <Th>{t('deliveryActionsDeliveryActionsIndex.askedFor')}</Th>
                <Th>{t('deliveryActionsDeliveryActionsIndex.why')}</Th>
                <Th>{t('deliveryActionsDeliveryActionsIndex.state')}</Th>
                <Th align="right">{t('deliveryActionsDeliveryActionsIndex.decide')}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link
                      href={`/orders?q=${r.order?.orderNumber ?? ''}`}
                      className="oo-link sk-ident"
                    >
                      {r.order?.orderNumber ?? '—'}
                    </Link>
                    <span className="oo-sub sk-ident">
                      {r.shipment?.awbNumber ?? r.shipment?.shipmentNumber ?? ''}
                    </span>
                  </Td>
                  <Td className="oo-muted">
                    {r.seller?.companyName ?? '—'}
                    {r.resellerStore !== null && (
                      <span className="oo-sub">
                        {t('deliveryActionsDeliveryActionsIndex.memberStore', {
                          value: r.resellerStore.displayName ?? r.resellerStore.name,
                        })}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className="oo-strong">{actionLabel(r.action)}</span>
                    {r.action === 'RECALL' && (
                      <span className="oo-sub">
                        {t('deliveryActionsDeliveryActionsIndex.noCourierInvolved')}
                      </span>
                    )}
                  </Td>
                  <Td className="oo-muted oo-clip">{r.reason}</Td>
                  <Td>
                    <div className="oo-stack oo-stack--tight">
                      <span className="oo-row">
                        <StatusChip
                          size="sm"
                          kind={statusKind(r.status)}
                          label={r.status.toLowerCase()}
                        />
                        <AgeChip
                          title={t('deliveryActionsDeliveryActionsIndex.asked', {
                            value: new Date(r.createdAt).toLocaleString('en-IN'),
                          })}
                        >
                          {elapsedSince(r.createdAt)}
                        </AgeChip>
                      </span>
                      {r.executionError !== null && (
                        <span className="oo-error">{r.executionError}</span>
                      )}
                      {r.decisionNote !== null && (
                        <span className="oo-faint">{r.decisionNote}</span>
                      )}
                    </div>
                  </Td>
                  <Td align="right">
                    {r.waitingOnSeller ? (
                      // Seller staff decide this one — the Reseller
                      // store's policy says so. Skydrop admin can see it,
                      // and the server refuses a decision here anyway.
                      <span className="oo-muted">
                        {t('deliveryActionsDeliveryActionsIndex.waitingOnClientStaff')}
                      </span>
                    ) : r.status === 'PENDING' && canDecide ? (
                      <div className="oo-row oo-row--end">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            setDeciding({ row: r, decision: 'approve' });
                            setNote('');
                          }}
                        >
                          {t('deliveryActionsDeliveryActionsIndex.approve')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setDeciding({ row: r, decision: 'reject' });
                            setNote('');
                          }}
                        >
                          {t('deliveryActionsDeliveryActionsIndex.decline')}
                        </Button>
                      </div>
                    ) : (
                      <span className="oo-faint">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </OoSection>

      <Dialog
        open={deciding !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDeciding(null);
            setError(null);
          }
        }}
        title={
          deciding?.decision === 'approve'
            ? t('deliveryActionsDeliveryActionsIndex.approve2', {
                value: deciding ? actionLabel(deciding.row.action) : '',
              })
            : t('deliveryActionsDeliveryActionsIndex.declineThisRequest')
        }
        description={
          deciding?.decision === 'approve'
            ? deciding.row.action === 'RECALL'
              ? t('deliveryActionsDeliveryActionsIndex.queuesTheOrderForOne')
              : t('deliveryActionsDeliveryActionsIndex.thisReachesDelhiveryARe')
            : t('deliveryActionsDeliveryActionsIndex.theClientSeesYourReason')
        }
        footer={
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeciding(null)}>
              {t('deliveryActionsDeliveryActionsIndex.cancel')}
            </Button>
            <AsyncButton
              variant="primary"
              labels={{
                idle:
                  deciding?.decision === 'approve'
                    ? t('deliveryActionsDeliveryActionsIndex.approveAndAct')
                    : t('deliveryActionsDeliveryActionsIndex.decline'),
                busy: t('deliveryActionsDeliveryActionsIndex.working'),
              }}
              onAction={async () => {
                const ok = await submit();
                if (!ok) throw new Error('refused');
              }}
            />
          </DialogFooter>
        }
      >
        {deciding !== null && (
          <div className="oo-stack">
            <div className="oo-row">
              <span className="sk-ident oo-strong">{deciding.row.order?.orderNumber ?? '—'}</span>
              <span className="oo-muted">
                {deciding.row.seller?.companyName ?? '—'} · {actionLabel(deciding.row.action)}
              </span>
            </div>
            {deciding.decision === 'approve' && deciding.row.action !== 'RECALL' && (
              <Notice tone="warn" icon={<AlertTriangle size={16} />}>
                <p>
                  {t(
                    'deliveryActionsDeliveryActionsIndex.delhiveryAnswersAsynchronouslyThisReturns',
                  )}
                </p>
              </Notice>
            )}
            <TextArea
              label={t('deliveryActionsDeliveryActionsIndex.note')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={
                deciding.decision === 'approve'
                  ? t('deliveryActionsDeliveryActionsIndex.optionalNoteForTheClient')
                  : t('deliveryActionsDeliveryActionsIndex.eGTwoAttemptsAlready')
              }
            />
            {error !== null && (
              <p className="oo-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
