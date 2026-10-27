'use client';

import { useState, type ReactElement } from 'react';
import { Search } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TextArea } from '@skydrop/ui/app/text-field';
import { Table, TBody, Td, THead, Th, Tr } from '@skydrop/ui/app/data-table';
import { useToast } from '@skydrop/ui/app/toast';
import { AfCard, AfSection } from '@/app/(authed)/system/_components/af-parts';
import './delhivery.css';
import { useTrackingLookup, type TrackingLookupResult } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { useT } from '@/i18n/client';

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
  const t = useT();
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
      // Rejects so the button shows it did not look anything up.
      throw new Error('Paste at least one AWB.');
    }
    try {
      const r = await lookup.mutateAsync(awbNumbers);
      setResults(r.results);
      if (r.stubMode) {
        toast.error('Stub mode is on — no courier was asked anything. Set the API base URLs.');
        return;
      }
      const known = r.results.filter((x) => x.known).length;
      // A courier that could not be asked has not said anything, so its
      // silence must not be reported as "unknown waybill".
      const unasked = r.unaskedCouriers ?? [];
      if (unasked.length > 0) {
        toast.error(
          `${unasked.join(', ')} could not be asked — no active courier account, so no token. ` +
            'A waybill of theirs will read as unknown whatever its real state.',
        );
      }
      toast.success(
        `${known} of ${r.results.length} known to the couriers asked.` +
          (known < r.results.length
            ? t('delhiveryTrackingLookupPanel.theRestReturnedNoScans')
            : ''),
      );
    } catch (err) {
      toast.error(serverVerdict(err));
      throw err;
    }
  }

  return (
    <AfSection
      title={t('delhiveryTrackingLookupPanel.lookUpAWaybill')}
      note={t('delhiveryTrackingLookupPanel.whatOurCouriersKnowAbout')}
    >
      <AfCard>
        <div className="dl-awbs">
          <TextArea
            label={t('delhiveryTrackingLookupPanel.awbNumbers')}
            rows={3}
            placeholder={'38061110518534\n38061110518535'}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            aria-label={t('delhiveryTrackingLookupPanel.awbNumbers')}
            hint={t('delhiveryTrackingLookupPanel.onePerLineOrComma')}
          />
        </div>
        <div>
          <AsyncButton
            variant="primary"
            size="md"
            icon={<Search size={14} />}
            labels={{
              idle: t('delhiveryTrackingLookupPanel.lookUp'),
              busy: t('delhiveryTrackingLookupPanel.askingDelhivery'),
              done: t('delhiveryTrackingLookupPanel.lookedUp'),
              error: t('delhiveryTrackingLookupPanel.lookupFailed'),
            }}
            disabled={lookup.isPending}
            onAction={run}
          />
        </div>
      </AfCard>

      {results.map((r) => (
        <AfCard key={r.awbNumber} flush={r.scans.length > 0}>
          <div className={r.scans.length > 0 ? 'af-row dl-result-head' : 'af-row'}>
            <span className="af-strong sk-ident">{r.awbNumber}</span>
            <StatusChip
              size="sm"
              kind={r.known ? 'delivered' : 'failed'}
              label={
                r.known
                  ? `${r.scans.length} scans`
                  : t('delhiveryTrackingLookupPanel.delhiveryHasNoScans')
              }
            />
            {r.ourShipmentId === null ? (
              <span className="af-faint">{t('delhiveryTrackingLookupPanel.notOneOfOurs')}</span>
            ) : (
              <span className="af-faint">
                {t('delhiveryTrackingLookupPanel.weHoldThisShipment')}
              </span>
            )}
          </div>
          {r.scans.length > 0 && (
            <Table>
              <THead>
                <Tr>
                  <Th>{t('delhiveryTrackingLookupPanel.courierTimeTheirs')}</Th>
                  <Th>{t('delhiveryTrackingLookupPanel.storedAsUtc')}</Th>
                  <Th>{t('delhiveryTrackingLookupPanel.leg')}</Th>
                  <Th>{t('delhiveryTrackingLookupPanel.status')}</Th>
                  <Th>NSL</Th>
                  <Th>{t('delhiveryTrackingLookupPanel.weReadItAs')}</Th>
                </Tr>
              </THead>
              <TBody>
                {r.scans.map((s, i) => (
                  <Tr key={`${s.eventAtIso}-${i}`}>
                    {/* Both times, side by side: their unzoned IST and
                        the instant we store. A 5h30m gap between them
                        is the timezone bug, visible without a query. */}
                    <Td>
                      <span className="af-small sk-figure af-nowrap">{s.courierTimestamp}</span>
                    </Td>
                    <Td>
                      <span className="af-small sk-figure af-nowrap">{s.eventAtIso}</span>
                    </Td>
                    <Td>{s.statusType ?? '—'}</Td>
                    <Td>{s.rawStatus}</Td>
                    <Td>
                      <span className="sk-ident">{s.nslCode ?? '—'}</span>
                    </Td>
                    <Td>{s.normalisedTo}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </AfCard>
      ))}
    </AfSection>
  );
}
