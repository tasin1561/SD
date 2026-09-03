'use client';

import Link from 'next/link';
import { useRef, useState, type ReactElement } from 'react';
import { AlertTriangle, Check, ScanLine } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  Input,
  Modal,
  ModalFooter,
  PageHeader,
  Section,
  StatusBadge,
} from '@skydrop/ui/components';
import { useHandoverScan, useScanBlock } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { BarcodeCamera, CameraScanButton } from '@/components/barcode-camera';

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
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [code, setCode] = useState('');
  const [camera, setCamera] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
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
    <Section>
      <PageHeader
        title="Handover"
        subtitle="Scan every parcel as it goes onto the van. The scan is the handover: the parcel is dispatched the moment it is read, and the manifest closes itself once its last parcel goes."
      />

      {block.data != null && (
        <Card>
          <CardBody>
            <div className="border-status-failed-fg/40 bg-status-failed-bg/40 rounded-md border p-3">
              <div className="text-status-failed-fg flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle size={15} /> Scanning is stopped
              </div>
              <p className="mt-1 text-sm">{block.data.title}</p>
              <p className="text-text-muted mt-2 text-xs whitespace-pre-line">
                {block.data.detail}
              </p>
              <p className="text-text-faint mt-2 text-xs">
                Put the box aside and get an admin. They clear it on{' '}
                <Link href="/system-issues" className="hover:text-text underline">
                  system issues
                </Link>
                , after checking whether there are two of them.
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          <label htmlFor="handover-scan" className="text-text-muted mb-1 block text-xs">
            Scan the shipping label
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="handover-scan"
              ref={inputRef}
              value={code}
              disabled={scan.isPending || refusal !== null || block.data != null}
              autoComplete="off"
              placeholder="AWB…"
              className="font-mono text-base"
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
          <p className="text-text-faint mt-1.5 text-xs">
            {done.length === 0 ? 'Nothing scanned yet.' : `${done.length} scanned in this session.`}
          </p>
          {/* The manifest is no longer a step, but "what went out on
              Tuesday's van" is still a real question, and this is where
              somebody stands when they ask it. */}
          <p className="text-text-faint mt-3 text-xs">
            <Link href="/warehouse/manifests" className="hover:text-text underline">
              Manifest history
            </Link>{' '}
            — closed out automatically as each van finishes loading.
          </p>
        </CardBody>
      </Card>

      {done.length > 0 && (
        <Card>
          <CardBody>
            <ul className="divide-border divide-y">
              {done.map((d, i) => (
                <li key={`${d.awb}-${i}`} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <div className="font-medium">{d.shipmentNumber}</div>
                    <div className="text-text-muted font-mono text-xs">{d.awb}</div>
                  </div>
                  {d.repeat ? (
                    <StatusBadge kind="draft" label="already gone" />
                  ) : (
                    <span className="flex items-center gap-2">
                      {d.manifestDispatched && (
                        <span className="text-text-faint text-xs">manifest closed</span>
                      )}
                      <span className="text-status-delivered-fg flex items-center gap-1 text-xs font-medium">
                        <Check size={13} /> {d.dispatched ? 'dispatched' : 'scanned'}
                      </span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
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

      <Modal
        open={refusal !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRefusal(null);
            inputRef.current?.focus();
          }
        }}
        title="That parcel was refused"
        tone="critical"
      >
        <p className="text-sm">{refusal}</p>
        <p className="text-text-muted mt-2 text-xs">
          It has NOT been recorded. Put it aside rather than loading it.
        </p>
        <ModalFooter>
          <Button
            onClick={() => {
              setRefusal(null);
              inputRef.current?.focus();
            }}
          >
            Understood
          </Button>
        </ModalFooter>
      </Modal>

      <div className="text-text-faint flex items-center gap-1.5 text-xs">
        <ScanLine size={12} />
        Turn this requirement on or off in Settings → ops.handover_scan_required.
      </div>
    </Section>
  );
}
