'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { PhoneCall } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { FilterBar, FilterField } from '@skydrop/ui/app/filter-bar';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TextField } from '@skydrop/ui/app/text-field';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useReattemptRequests,
  useDecideReattempt,
  type AdminReattemptRequest,
} from '@/lib/callcenter-hooks';
import { AgeChip } from '../../orders/_components/order-ops-parts';
import { useT } from '@/i18n/client';

/**
 * Sellers asking to ring a customer who declined.
 *
 * The whole point of this screen is that a human sees the reason before
 * anybody dials. Approving is what makes the single edge out of
 * REJECTED_BY_CUSTOMER reachable — there is no other way back.
 */
export function ReattemptRequestsIndex(): ReactElement {
  const t = useT();
  const [status, setStatus] = useState('PENDING');
  const list = useReattemptRequests(status === '' ? undefined : status);
  const [deciding, setDeciding] = useState<{
    row: AdminReattemptRequest;
    approve: boolean;
  } | null>(null);

  return (
    <div className="oo-page">
      <PageHeader
        title={t('reattemptRequestsReattemptRequestsIndex.reAttemptRequests')}
        subtitle={t('reattemptRequestsReattemptRequestsIndex.clientsAskingUsToCall')}
      />

      <FilterBar activeCount={status === 'PENDING' ? 0 : 1}>
        <FilterField>
          <Select
            id="ra-status"
            label={t('reattemptRequestsReattemptRequestsIndex.status')}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="PENDING">
              {t('reattemptRequestsReattemptRequestsIndex.waitingForADecision')}
            </option>
            <option value="APPROVED">
              {t('reattemptRequestsReattemptRequestsIndex.approved')}
            </option>
            <option value="REJECTED">
              {t('reattemptRequestsReattemptRequestsIndex.declined')}
            </option>
            <option value="">{t('reattemptRequestsReattemptRequestsIndex.all')}</option>
          </Select>
        </FilterField>
      </FilterBar>

      {list.isLoading ? (
        <SkeletonRows
          rows={3}
          cols={3}
          label={t('reattemptRequestsReattemptRequestsIndex.loadingRequests')}
        />
      ) : list.error !== null ? (
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          tone={status === 'PENDING' ? 'positive' : 'neutral'}
          icon={<PhoneCall size={20} />}
          title={t('reattemptRequestsReattemptRequestsIndex.nothingWaiting')}
          description={t('reattemptRequestsReattemptRequestsIndex.whenAClientAsksUs')}
        />
      ) : (
        <ul
          className="oo-queue"
          aria-label={t('reattemptRequestsReattemptRequestsIndex.reAttemptRequests')}
        >
          {(list.data ?? []).map((r) => (
            <li
              key={r.id}
              className="oo-qcard"
              data-severity={r.status === 'PENDING' ? 'medium' : undefined}
            >
              <div className="oo-qcard__head">
                <div className="oo-qcard__title">
                  {r.orderNumber !== null && (
                    <Link href={`/orders/${r.orderId}`} className="oo-link sk-ident">
                      {r.orderNumber}
                    </Link>
                  )}
                </div>
                <div className="oo-qcard__chips">
                  <StatusChip
                    size="sm"
                    kind={
                      r.status === 'PENDING'
                        ? 'pending'
                        : r.status === 'APPROVED'
                          ? 'confirmed'
                          : 'failed'
                    }
                    label={r.status.toLowerCase()}
                  />
                  <AgeChip title={t('reattemptRequestsReattemptRequestsIndex.whenTheClientAsked')}>
                    {t('reattemptRequestsReattemptRequestsIndex.asked', {
                      value: new Date(r.createdAt).toLocaleString('en-IN'),
                    })}
                  </AgeChip>
                </div>
              </div>

              {/* The reason IS the decision. Rendered at full size,
                  not truncated into a column. */}
              <p className="oo-body">{r.reason}</p>

              {r.status === 'APPROVED' && r.extraAttempts > 0 && (
                <p className="oo-p">
                  <span className="oo-faint">
                    {t('reattemptRequestsReattemptRequestsIndex.granted')}
                  </span>{' '}
                  <span className="sk-figure">{r.extraAttempts}</span> extra{' '}
                  {r.extraAttempts === 1 ? 'call' : 'calls'}
                </p>
              )}

              {r.decisionNote !== null && r.decisionNote !== '' && (
                <p className="oo-p">
                  <span className="oo-faint">
                    {t('reattemptRequestsReattemptRequestsIndex.decisionNote')}
                  </span>{' '}
                  {r.decisionNote}
                </p>
              )}

              {r.status === 'PENDING' && (
                <div className="oo-row">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => setDeciding({ row: r, approve: true })}
                  >
                    {t('reattemptRequestsReattemptRequestsIndex.approveCallAgain')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeciding({ row: r, approve: false })}
                  >
                    {t('reattemptRequestsReattemptRequestsIndex.decline')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Decide target={deciding} onClose={() => setDeciding(null)} />
    </div>
  );
}

function Decide({
  target,
  onClose,
}: {
  target: { row: AdminReattemptRequest; approve: boolean } | null;
  onClose: () => void;
}): ReactElement {
  const t = useT();
  const decide = useDecideReattempt();
  const [note, setNote] = useState('');
  const [extra, setExtra] = useState('1');

  function close(): void {
    setNote('');
    setExtra('1');
    decide.reset();
    onClose();
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={
        target?.approve === true
          ? t('reattemptRequestsReattemptRequestsIndex.putThisOrderBackIn')
          : t('reattemptRequestsReattemptRequestsIndex.declineThisRequest')
      }
      description={
        target?.approve === true
          ? t('reattemptRequestsReattemptRequestsIndex.theOrderReturnsToPending')
          : t('reattemptRequestsReattemptRequestsIndex.theOrderStaysRejectedThe')
      }
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={close}>
            {t('reattemptRequestsReattemptRequestsIndex.cancel')}
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            labels={{
              idle:
                target?.approve === true
                  ? t('reattemptRequestsReattemptRequestsIndex.approve')
                  : t('reattemptRequestsReattemptRequestsIndex.declineRequest'),
              busy: t('reattemptRequestsReattemptRequestsIndex.saving'),
            }}
            onAction={async () => {
              if (target !== null) {
                await decide.mutateAsync({
                  requestId: target.row.id,
                  approve: target.approve,
                  note: note.trim(),
                  extraAttempts: Number(extra),
                });
                close();
              }
            }}
          />
        </DialogFooter>
      }
    >
      <div className="oo-stack">
        {target !== null && (
          <div className="oo-row">
            <span className="sk-ident oo-strong">{target.row.orderNumber ?? '—'}</span>
            <span className="oo-muted">
              {t('reattemptRequestsReattemptRequestsIndex.askedByTheClient')}
            </span>
          </div>
        )}
        {target?.approve === true && (
          <Select
            id="ra-extra"
            label={t('reattemptRequestsReattemptRequestsIndex.extraCallsToAllow')}
            hint={t('reattemptRequestsReattemptRequestsIndex.onTopOfTheClient')}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
          >
            {['1', '2', '3', '4', '5'].map((n) => (
              <option key={n} value={n}>
                {t('reattemptRequestsReattemptRequestsIndex.more', {
                  n,
                  value:
                    n === '1'
                      ? t('reattemptRequestsReattemptRequestsIndex.call')
                      : t('reattemptRequestsReattemptRequestsIndex.calls'),
                })}
              </option>
            ))}
          </Select>
        )}

        <TextField
          id="ra-note"
          label={t('reattemptRequestsReattemptRequestsIndex.note')}
          hint={t('reattemptRequestsReattemptRequestsIndex.optionalRecordedWithTheDecision')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {decide.error !== null && (
          <p className="oo-error" role="alert">
            {serverVerdict(decide.error)}
          </p>
        )}
      </div>
    </Dialog>
  );
}
