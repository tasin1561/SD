'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { AlertTriangle, OctagonX, ScanLine, Truck } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { ListRow } from '@skydrop/ui/app/list-row';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { useHandoverScan, useScanBlock } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { BarcodeCamera, CameraScanButton } from '@/components/barcode-camera';
import { HandoverQueue } from './handover-queue';
import '../../_components/benches.css';

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
  const scan = useHandoverScan();
  const block = useScanBlock();
  const canManagePickups = usePermission('courier.pickups.manage');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [code, setCode] = useState('');
  const [camera, setCamera] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

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
  const [done, setDone] = useState<
    Array<{
      shipmentNumber: string;
      awb: string;
      repeat: boolean;
      dispatched: boolean;
      manifestDispatched: boolean;
    }>
  >([]);

  async function submit(value: string): Promise<void> {
    const awb = value.trim();
    if (awb === '') return;
    setCode('');
    try {
      const r = await scan.mutateAsync(awb);
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
    } finally {
      inputRef.current?.focus();
    }
  }

  return (
    <div className="wh-page">
      <PageHeader
        breadcrumbs={[{ label: 'Warehouse', href: '/warehouse' }, { label: 'Handover' }]}
        Link={Link}
        title="Handover"
        subtitle="Scan every parcel as it goes onto the van. The scan is the handover: the parcel is dispatched the moment it is read, and the manifest closes itself once its last parcel goes."
      />

      {block.data != null && (
        <div className="wh-stop">
          <div className="wh-stop__title">
            <AlertTriangle size={18} /> Scanning is stopped
          </div>
          <p>{block.data.title}</p>
          <p className="wh-pre">{block.data.detail}</p>
          <p>
            Put the box aside and get an admin. They clear it on{' '}
            <Link href="/system-issues" className="wh-link">
              system issues
            </Link>
            , after checking whether there are two of them.
          </p>
        </div>
      )}

      <section className="wh-card wh-scan">
        <label htmlFor="handover-scan" className="wh-scan__label">
          Scan the shipping label
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
        </div>
        <p className="wh-scan__meta">
          {done.length === 0 ? 'Nothing scanned yet.' : `${done.length} scanned in this session.`}
        </p>
        {/* The manifest is no longer a step, but "what went out on
            Tuesday's van" is still a real question, and this is where
            somebody stands when they ask it. */}
        <p className="wh-faint">
          <Link href="/warehouse/manifests" className="wh-link">
            Manifest history
          </Link>{' '}
          — closed out automatically as each van finishes loading.
        </p>
        {/* The van is asked for automatically when the day's first box
            is packed (CUR-10 amendment #3). A day that failed is not
            retried by itself; that, and a parcel that never passed the
            pack bench, is arranged on the pickups screen. */}
        {canManagePickups && (
          <p className="wh-faint">
            No van coming?{' '}
            <Link href="/warehouse/pickups" className="wh-link">
              Pickups
            </Link>{' '}
            — retry a failed day or ask for one by hand.
          </p>
        )}
      </section>

      {/* What is LEFT, not only what is done. */}
      <HandoverQueue />

      {done.length > 0 && (
        <section className="wh-card" data-flush="1">
          <div className="wh-card__head">
            <h2 className="wh-card__title">This session</h2>
            <div className="wh-card__sub">Newest first</div>
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
                      <span className="wh-faint">manifest closed</span>
                    ) : undefined
                  }
                  status={
                    d.repeat ? (
                      <StatusChip kind="draft" label="already gone" size="sm" />
                    ) : (
                      <StatusChip
                        kind="delivered"
                        label={d.dispatched ? 'dispatched' : 'scanned'}
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
        title="Scan the shipping label"
      />

      <Dialog
        open={refusal !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRefusal(null);
            inputRef.current?.focus();
          }
        }}
        title="That parcel was refused"
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
              Understood
            </Button>
          </DialogFooter>
        }
      >
        <p className="wh-alert">{refusal}</p>
        <p className="wh-note wh-gap-top">
          It has NOT been recorded. Put it aside rather than loading it.
        </p>
      </Dialog>

      <p className="wh-faint wh-row">
        <ScanLine size={12} aria-hidden />
        Turn this requirement on or off in Settings → ops.handover_scan_required.
      </p>
    </div>
  );
}
