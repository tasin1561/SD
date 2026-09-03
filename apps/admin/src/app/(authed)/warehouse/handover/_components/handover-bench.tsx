'use client';

import { useRef, useState, type ReactElement } from 'react';
import { Check, ScanLine } from 'lucide-react';
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
import { useHandoverScan } from '@/lib/ops-hooks';
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
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [code, setCode] = useState('');
  const [camera, setCamera] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [done, setDone] = useState<Array<{ shipmentNumber: string; awb: string; repeat: boolean }>>(
    [],
  );

  async function submit(value: string): Promise<void> {
    const awb = value.trim();
    if (awb === '') return;
    setCode('');
    try {
      const r = await scan.mutateAsync(awb);
      setDone((prev) => [
        { shipmentNumber: r.shipmentNumber, awb, repeat: r.alreadyScanned },
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
        subtitle="Scan every parcel as it goes onto the van. While this is switched on, a handoff refuses anything that was not scanned."
      />

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
              disabled={scan.isPending || refusal !== null}
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
                    <StatusBadge kind="draft" label="already scanned" />
                  ) : (
                    <span className="text-status-delivered-fg flex items-center gap-1 text-xs font-medium">
                      <Check size={13} /> scanned
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
