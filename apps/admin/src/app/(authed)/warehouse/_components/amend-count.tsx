'use client';

import Link from 'next/link';
import { useId, useState, type ReactElement } from 'react';
import { ArrowRight, PencilLine, ShieldAlert, X } from 'lucide-react';
import { ApiError } from '@skydrop/api-client';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { TextField } from '@skydrop/ui/app/text-field';
import { countCorrectionHref } from '@/lib/adjustment-prefill';
import { useAmendReceiptLineCount } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { useT } from '@/i18n/client';
import './amend-count.css';

/** The server's own code for "this count already became stock". */
const BANKED = 'RECEIPT_COUNT_ALREADY_BANKED';

/** The reason the server demands; told to the user BEFORE they submit. */
const REASON_MIN = 10;

function errorCode(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) return undefined;
  const body = err.body as { code?: unknown } | null;
  return typeof body?.code === 'string' ? body.code : err.code;
}

function wholeNumber(raw: string): number | null {
  return /^\d{1,7}$/.test(raw.trim()) ? Number(raw.trim()) : null;
}

/**
 * Edit one counted line. Appears only for staff holding
 * `inventory.goods_receipts.amend_count` — cosmetic (FE-2): the server is
 * the boundary and its refusal is shown verbatim, including
 * `RECEIPT_COUNT_ALREADY_BANKED`, which is answered with a path to a stock
 * adjustment rather than a dead end.
 *
 * Deliberately does NOT decide whether the receipt "may" be amended: that
 * is the server's policy. It is offered on a receipt that has been (or is
 * being) counted and the server says yes or no.
 */
export function AmendCount({
  receiptId,
  lineId,
  skuCode,
  receivedQty,
  damagedQty,
  sellerId,
  variantId,
  binId,
  batchId,
}: {
  readonly receiptId: string;
  readonly lineId: string;
  readonly skuCode: string;
  readonly receivedQty: number | null;
  readonly damagedQty: number | null;
  readonly sellerId: string;
  readonly variantId: string;
  readonly binId?: string | null | undefined;
  readonly batchId?: string | null | undefined;
}): ReactElement | null {
  const t = useT();
  const mayAmend = usePermission('inventory.goods_receipts.amend_count');
  const amend = useAmendReceiptLineCount();
  const uid = useId();

  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [received, setReceived] = useState('');
  const [damaged, setDamaged] = useState('');
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<{ message: string; banked: boolean } | null>(null);

  if (!mayAmend) return null;

  const panelId = `${uid}-panel`;
  const receivedN = wholeNumber(received);
  const damagedN = damaged.trim() === '' ? undefined : wholeNumber(damaged);
  const reasonLen = reason.trim().length;
  const reasonOk = reasonLen >= REASON_MIN;
  const valid = receivedN !== null && damagedN !== null && reasonOk;

  function openForm(): void {
    setReceived(String(receivedQty ?? 0));
    setDamaged(String(damagedQty ?? 0));
    setReason('');
    setConfirming(false);
    setFailure(null);
    setOpen(true);
  }

  function close(): void {
    setOpen(false);
    setConfirming(false);
    setFailure(null);
  }

  async function save(): Promise<void> {
    if (receivedN === null || damagedN === null) return;
    setFailure(null);
    try {
      await amend.mutateAsync({
        receiptId,
        lineId,
        receivedQty: receivedN,
        damagedQty: damagedN,
        reason: reason.trim(),
      });
    } catch (err) {
      setFailure({
        message: serverVerdict(err, t('warehouseAmendCount.couldNotSave')),
        banked: errorCode(err) === BANKED,
      });
      throw err;
    }
  }

  return (
    <div className="amc">
      <Button
        variant="ghost"
        size="sm"
        icon={<PencilLine size={14} aria-hidden />}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t('warehouseAmendCount.editCountFor', { skuCode })}
        onClick={() => (open ? close() : openForm())}
      >
        {t('warehouseAmendCount.editCount')}
      </Button>

      {open && (
        <form
          id={panelId}
          className="amc__panel"
          aria-label={t('warehouseAmendCount.editCountFor', { skuCode })}
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) setConfirming(true);
          }}
        >
          <div className="amc__head">
            <span className="amc__title">{t('warehouseAmendCount.amendTheCount')}</span>
            <button
              type="button"
              className="amc__close"
              aria-label={t('warehouseAmendCount.close')}
              onClick={close}
            >
              <X size={16} aria-hidden />
            </button>
          </div>

          <div className="amc__fields">
            <TextField
              label={t('warehouseAmendCount.received')}
              type="number"
              min={0}
              inputMode="numeric"
              inputClassName="sk-figure"
              value={received}
              disabled={confirming}
              status={receivedN === null ? 'invalid' : 'valid'}
              error={receivedN === null ? t('warehouseAmendCount.wholeNumber') : undefined}
              onChange={(e) => setReceived(e.target.value)}
            />
            <TextField
              label={t('warehouseAmendCount.damaged')}
              type="number"
              min={0}
              inputMode="numeric"
              inputClassName="sk-figure"
              value={damaged}
              disabled={confirming}
              status={damagedN === null ? 'invalid' : 'valid'}
              error={damagedN === null ? t('warehouseAmendCount.wholeNumber') : undefined}
              onChange={(e) => setDamaged(e.target.value)}
            />
          </div>

          <TextField
            label={t('warehouseAmendCount.why')}
            requiredMark
            value={reason}
            disabled={confirming}
            status={reasonLen === 0 ? undefined : reasonOk ? 'valid' : 'invalid'}
            hint={t('warehouseAmendCount.reasonHint', { min: REASON_MIN })}
            after={
              <span className="amc__count sk-figure" data-ok={reasonOk} aria-live="polite">
                {t('warehouseAmendCount.counter', { n: reasonLen, min: REASON_MIN })}
              </span>
            }
            placeholder={t('warehouseAmendCount.reasonPlaceholder')}
            onChange={(e) => setReason(e.target.value)}
          />

          {!confirming && (
            <div className="amc__actions">
              <Button type="button" variant="ghost" size="md" onClick={close}>
                {t('warehouseAmendCount.cancel')}
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={!valid}>
                {t('warehouseAmendCount.review')}
              </Button>
            </div>
          )}

          {confirming && (
            <div
              className="amc__confirm"
              role="group"
              aria-label={t('warehouseAmendCount.confirmTitle')}
            >
              <p className="amc__confirm-line">
                <ShieldAlert size={16} aria-hidden />
                <span>
                  {t('warehouseAmendCount.confirmBody', {
                    skuCode,
                    from: receivedQty ?? 0,
                    to: receivedN ?? 0,
                  })}
                </span>
              </p>
              <div className="amc__actions">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => {
                    setConfirming(false);
                    setFailure(null);
                  }}
                >
                  {t('warehouseAmendCount.back')}
                </Button>
                <AsyncButton
                  type="button"
                  variant="primary"
                  size="md"
                  labels={{
                    idle: t('warehouseAmendCount.confirmSave'),
                    busy: t('warehouseAmendCount.saving'),
                    done: t('warehouseAmendCount.saved'),
                    error: t('warehouseAmendCount.refusedRetry'),
                  }}
                  settleMs={1100}
                  onAction={save}
                  onSettled={(r) => {
                    if (r.ok) window.setTimeout(close, 900);
                  }}
                />
              </div>
            </div>
          )}

          {failure !== null && (
            <div className="amc__failure" role="alert" data-banked={failure.banked}>
              <p className="amc__failure-msg">{failure.message}</p>
              {failure.banked && (
                <p className="amc__next">
                  <span>{t('warehouseAmendCount.bankedExplain')}</span>
                  <Link
                    href={countCorrectionHref({ sellerId, variantId, binId, batchId })}
                    className="amc__next-link"
                  >
                    {t('warehouseAmendCount.adjustStock', { skuCode })}
                    <ArrowRight size={14} aria-hidden />
                  </Link>
                </p>
              )}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
