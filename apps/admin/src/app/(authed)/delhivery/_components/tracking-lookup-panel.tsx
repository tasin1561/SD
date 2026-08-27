'use client';

import { useState, type ReactElement } from 'react';
import { Search } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  Section,
  StatusBadge,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { useTrackingLookup, type TrackingLookupResult } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

/**
 * Ask Delhivery about specific waybills and see what we would make of
 * the answer — without acting on any of it.
 *
 * The poll cycle answers the same question, but only for parcels we
 * already hold, and it ACTS: writes tracking events, moves orders,
 * credits money downstream. That makes it the wrong instrument for "is
 * realtime status working", because using it requires real parcels
 * already in flight.
 *
 * This reads any waybill and writes nothing, so it can be pointed at a
 * parcel that is not ours. Reads are free and side-effect-free at
 * Delhivery's end — unlike a manifest, a cancel or an NDR action.
 */
export function TrackingLookupPanel(): ReactElement | null {
  const mayLookup = usePermission('orders.tracking.run_poll');
  const toast = useToast();
  const lookup = useTrackingLookup();
  const [raw, setRaw] = useState('');
  const [results, setResults] = useState<TrackingLookupResult[]>([]);

  if (!mayLookup) return null;

  async function run(): Promise<void> {
    // One per line or comma-separated, because that is how a list of
    // waybills arrives — pasted out of a spreadsheet or an email.
    const awbNumbers = raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s !== '');
    if (awbNumbers.length === 0) {
      toast.error('Paste at least one AWB.');
      return;
    }
    try {
      const r = await lookup.mutateAsync(awbNumbers);
      setResults(r.results);
      if (r.stubMode) {
        toast.error('Stub mode is on — nothing was asked of Delhivery. Set the API base URL.');
        return;
      }
      const known = r.results.filter((x) => x.known).length;
      toast.success(
        `${known} of ${r.results.length} known to Delhivery.` +
          (known < r.results.length ? ' The rest returned no scans.' : ''),
      );
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  return (
    <Section
      title="Look up a waybill"
      subtitle="What Delhivery knows about an AWB, and what our mapping makes of it. Reads only — no tracking event is written and no order moves."
    >
      <Card>
        <CardBody>
          <div className="space-y-3">
            <textarea
              className="sd-field min-h-[76px] w-full font-mono text-sm"
              placeholder={'38061110518534\n38061110518535'}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              aria-label="AWB numbers"
            />
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="md"
                disabled={lookup.isPending}
                onClick={() => void run()}
              >
                <Search size={14} aria-hidden />
                {lookup.isPending ? 'Asking Delhivery…' : 'Look up'}
              </Button>
              <span className="text-text-faint text-xs">
                One per line or comma-separated. Up to 50 — their cap per call.
              </span>
            </div>
          </div>
        </CardBody>
      </Card>

      {results.map((r) => (
        <Card key={r.awbNumber}>
          <CardBody>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">{r.awbNumber}</span>
              <StatusBadge
                kind={r.known ? 'delivered' : 'failed'}
                label={r.known ? `${r.scans.length} scans` : 'Delhivery has no scans'}
              />
              {r.ourShipmentId === null ? (
                <span className="text-text-faint text-xs">not one of ours</span>
              ) : (
                <span className="text-text-faint text-xs">we hold this shipment</span>
              )}
            </div>
            {r.scans.length > 0 && (
              <Table>
                <THead>
                  <Tr>
                    <Th>Courier time (theirs)</Th>
                    <Th>Stored as (UTC)</Th>
                    <Th>Leg</Th>
                    <Th>Status</Th>
                    <Th>NSL</Th>
                    <Th>We read it as</Th>
                  </Tr>
                </THead>
                <TBody>
                  {r.scans.map((s, i) => (
                    <Tr key={`${s.eventAtIso}-${i}`}>
                      {/* Both times, side by side: their unzoned IST and
                          the instant we store. A 5h30m gap between them
                          is the timezone bug, visible without a query. */}
                      <Td className="font-mono text-xs">{s.courierTimestamp}</Td>
                      <Td className="font-mono text-xs">{s.eventAtIso}</Td>
                      <Td>{s.statusType ?? '—'}</Td>
                      <Td>{s.rawStatus}</Td>
                      <Td>{s.nslCode ?? '—'}</Td>
                      <Td>{s.normalisedTo}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      ))}
    </Section>
  );
}
