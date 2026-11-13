'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { AlertTriangle, CircleCheck, OctagonX, Truck } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { ListRow } from '@skydrop/ui/app/list-row';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { useHandoverScan, useScanBlock } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { useScanSound } from '@/lib/scan-sound';
import { ScanSoundToggle } from '@/components/scan-sound-toggle';
import { BarcodeCamera, CameraScanButton } from '@/components/barcode-camera';
import { HandoverQueue } from './handover-queue';
import '../../_components/benches.css';
import './handover.css';
import { InfoButton } from '@/components/easy/info-button';
import '@/components/easy/easy.css';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/client';

/**
 * The last look at a parcel before a driver takes it.
 *
 * Only meaningful when `ops.handover_scan_required` is on — and when it
 * is, the SERVER refuses a handoff containing anything unscanned. This
 * screen is how somebody satisfies that gate; it is not the gate. A
 * check that lives in a screen is one `curl` away from not existing.
 *
 * Deliberately a running LIST rather than a form that clears: the whole
 * job is "did I do all forty", and a screen that forgets each parcel the
 * moment it is scanned cannot answer that.
 */
export function HandoverBench(): ReactElement {
  const t = useT();

  const scan = useHandoverScan();
  const block = useScanBlock();
  const canManagePickups = usePermission('courier.pickups.manage');
  // The same two sounds as every other bench (one pair, learned once).
  const sound = useScanSound();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [code, setCode] = useState('');
  const [camera, setCamera] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // The field takes focus the moment the bench opens. A scan gun types
  // into whatever has focus, and this field had none on arrival — the
  // first parcel of every session was scanned into nothing until somebody
  // noticed and clicked the box (2026-11-13).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // After a refusal is acknowledged the field re-enables in the same render
  // that closes the dialog, so focus() at the click finds it still disabled
  // and the dialog's own focus-return then lands on <body>. Give the field
  // focus on the next frame instead, once both have settled — the next
  // scan must go straight in (fixed 2026-09-23, owner).
  const hadRefusal = useRef(false);
  useEffect(() => {
    if (refusal !== null) {
      hadRefusal.current = true;
      return;
    }
    if (!hadRefusal.current) return;
    hadRefusal.current = false;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [refusal]);

  // SCAN-1 — the operator is stopped. Once, when the stop appears.
  const wasBlocked = useRef(false);
  const blocked = block.data != null;
  useEffect(() => {
    if (blocked && !wasBlocked.current) sound.refused();
    wasBlocked.current = blocked;
  }, [blocked, sound]);
  const [done, setDone] = useState<
    Array<{
      shipmentNumber: string;
      awb: string;
      repeat: boolean;
      dispatched: boolean;
      manifestDispatched: boolean;
    }>
  >([]);

  const last = done[0];

  async function submit(value: string): Promise<void> {
    const awb = value.trim();
    if (awb === '') return;
    setCode('');
    // The keypress that got here is the gesture the browser waits for.
    sound.prime();
    try {
      const r = await scan.mutateAsync(awb);
      sound.accepted();
      setDone((prev) => [
        {
          shipmentNumber: r.shipmentNumber,
          awb,
          repeat: r.alreadyScanned,
          dispatched: r.dispatched,
          manifestDispatched: r.manifestDispatched,
        },
        ...prev,
      ]);
    } catch (err) {
      // Blocking, like the packing bench: a scan gun types and presses
      // Enter by itself, so a non-blocking warning is a warning the next
      // scan wipes off the screen.
      setRefusal(serverVerdict(err));
      // If the screen says no, the room hears no.
      sound.refused();
    } finally {
      inputRef.current?.focus();
    }
  }

  return (
    <div className="wh-page ez-touch">
      <PageHeader
        breadcrumbs={[
          { label: t('warehouseHandoverHandoverBench.warehouse'), href: '/warehouse' },
          { label: t('warehouseHandoverHandoverBench.handover') },
        ]}
        Link={Link}
        title={
          <span className="ez-titled">
            {t('warehouseHandoverHandoverBench.handover')}
            <InfoButton
              title={t('warehouseHandoverHandoverBench.handover')}
              text={`${t('warehouseHandoverHandoverBench.scanEveryParcelAsIt')}\n\n${t('warehouseHandoverHandoverBench.turnThisRequirementOnOr')}`}
            />
          </span>
        }
      />

      {block.data != null && (
        <div className="wh-stop">
          <div className="wh-stop__title">
            <AlertTriangle size={18} /> {t('warehouseHandoverHandoverBench.scanningIsStopped')}
          </div>
          <p>{block.data.title}</p>
          <p className="wh-pre">{block.data.detail}</p>
          <p>
            {richMessage(t('warehouseHandoverHandoverBench.putTheBoxAsideAnd'), {
              link: (
                <Link href="/system-issues" className="wh-link">
                  {t('warehouseHandoverHandoverBench.systemIssues')}
                </Link>
              ),
            })}
          </p>
        </div>
      )}

      <section className="wh-card wh-scan">
        <label htmlFor="handover-scan" className="wh-scan__label">
          {t('warehouseHandoverHandoverBench.scanTheShippingLabel')}
        </label>
        <div className="wh-scan__row">
          <input
            id="handover-scan"
            ref={inputRef}
            value={code}
            disabled={scan.isPending || refusal !== null || block.data != null}
            autoComplete="off"
            placeholder="AWB…"
            className="wh-scan__input"
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit(code);
              }
            }}
          />
          <CameraScanButton onClick={() => setCamera(true)} />
          <div className="wh-steps-bar__aside">
            <ScanSoundToggle />
          </div>
        </div>
        {/* What the person at the van looks up for between boxes: did
            that one go in, and how many is that. Large enough to read from
            arm's length with a parcel in both hands; announced for a
            screen reader. The full list is further down. */}
        <div className="ho-tally" aria-live="polite">
          <div className="ho-tally__count" aria-hidden>
            <span className="ho-tally__num sk-figure">{done.length}</span>
            <span className="ho-tally__label">{t('ezHandover.countLabel')}</span>
          </div>
          {/* The same count as one sentence, for a screen reader. */}
          <span className="wh-sr">
            {t('warehouseHandoverHandoverBench.scannedInThisSession', { length: done.length })}
          </span>
          {last !== undefined ? (
            <div className="ho-last" data-repeat={last.repeat ? '1' : undefined}>
              <span className="ho-last__icon" aria-hidden>
                {last.repeat ? <AlertTriangle size={22} /> : <CircleCheck size={22} />}
              </span>
              <span className="ho-last__text">
                <span className="ho-last__kicker">{t('ezHandover.lastScan')}</span>
                <span className="ho-last__no">{last.shipmentNumber}</span>
                <span className="sk-ident">{last.awb}</span>
              </span>
              <StatusChip
                kind={last.repeat ? 'draft' : 'delivered'}
                label={
                  last.repeat
                    ? t('warehouseHandoverHandoverBench.alreadyGone')
                    : last.dispatched
                      ? t('ezHandover.dispatched')
                      : t('ezHandover.scanned')
                }
                size="sm"
              />
            </div>
          ) : (
            <p className="wh-scan__meta">{t('warehouseHandoverHandoverBench.nothingScannedYet')}</p>
          )}
        </div>
        {/* The manifest is no longer a step, but "what went out on
            Tuesday's van" is still a real question, and this is where
            somebody stands when they ask it. */}
        <p className="wh-faint ez-titled">
          <Link href="/warehouse/manifests" className="wh-link ho-link">
            {t('warehouseHandoverHandoverBench.manifestHistory')}
          </Link>
          <InfoButton
            title={t('warehouseHandoverHandoverBench.manifestHistory')}
            text={t('warehouseHandoverHandoverBench.closedOutAutomaticallyAsEach')}
          />
        </p>
        {/* The van is asked for automatically when the day's first box
            is packed (CUR-10 amendment #3). A day that failed is not
            retried by itself; that, and a parcel that never passed the
            pack bench, is arranged on the pickups screen. */}
        {canManagePickups && (
          <p className="wh-faint">
            {richMessage(t('warehouseHandoverHandoverBench.noVanComingRetryA'), {
              link: (
                <Link href="/warehouse/pickups" className="wh-link">
                  {t('warehouseHandoverHandoverBench.pickups')}
                </Link>
              ),
            })}
          </p>
        )}
      </section>

      {/* What is LEFT, not only what is done. */}
      <HandoverQueue />

      {done.length > 0 && (
        <section className="wh-card" data-flush="1">
          <div className="wh-card__head">
            <h2 className="wh-card__title">{t('warehouseHandoverHandoverBench.thisSession')}</h2>
            <div className="wh-card__sub">{t('warehouseHandoverHandoverBench.newestFirst')}</div>
          </div>
          <ul className="wh-list">
            {done.map((d, i) => (
              <li key={`${d.awb}-${i}`}>
                <ListRow
                  icon={<Truck size={16} />}
                  title={d.shipmentNumber}
                  description={<span className="sk-ident">{d.awb}</span>}
                  meta={
                    !d.repeat && d.manifestDispatched ? (
                      <span className="wh-faint">
                        {t('warehouseHandoverHandoverBench.manifestClosed')}
                      </span>
                    ) : undefined
                  }
                  status={
                    d.repeat ? (
                      <StatusChip
                        kind="draft"
                        label={t('warehouseHandoverHandoverBench.alreadyGone')}
                        size="sm"
                      />
                    ) : (
                      <StatusChip
                        kind="delivered"
                        // In the reader's language — these two were
                        // hard-coded English words in every language.
                        label={d.dispatched ? t('ezHandover.dispatched') : t('ezHandover.scanned')}
                        size="sm"
                      />
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <BarcodeCamera
        open={camera}
        onClose={() => setCamera(false)}
        onScan={(scanned) => {
          setCamera(false);
          void submit(scanned);
        }}
        title={t('warehouseHandoverHandoverBench.scanTheShippingLabel')}
      />

      <Dialog
        open={refusal !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRefusal(null);
            inputRef.current?.focus();
          }
        }}
        title={t('warehouseHandoverHandoverBench.thatParcelWasRefused')}
        tone="critical"
        icon={<OctagonX size={18} />}
        footer={
          <DialogFooter>
            <Button
              onClick={() => {
                setRefusal(null);
                inputRef.current?.focus();
              }}
            >
              {t('warehouseHandoverHandoverBench.understood')}
            </Button>
          </DialogFooter>
        }
      >
        <p className="wh-alert">{refusal}</p>
        <p className="wh-note wh-gap-top">
          {t('warehouseHandoverHandoverBench.itHasNotBeenRecorded')}
        </p>
      </Dialog>
    </div>
  );
}
