'use client';

import type { ReactElement } from 'react';
import { Lock } from 'lucide-react';
import {
  Card,
  CardBody,
  EmptyState,
  ErrorNote,
  PageHeader,
  Section,
  SkeletonRows,
  Stat,
  StatusBadge,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { useCourierPortalRuns, useCourierTaxonomy, useCourierChannel } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { EscalationTabs } from '../../_components/escalation-tabs';

/**
 * What the portal worker did — or, in SHADOW, would have done.
 *
 * ── SHADOW IS ONLY A DRY RUN IF SOMEBODY READS IT ────────────────────
 * The worker ships in SHADOW: it navigates, reads, decides, and writes
 * nothing. That is worth exactly as much as the record of it is legible,
 * and until this page existed the record went into a table with no
 * reader. This is where "it has been running for a week and here is what
 * it would have done" becomes a sentence somebody can check.
 *
 * ── THE TAXONOMY IS THE UNBLOCKER ────────────────────────────────────
 * Unattended action is refused outright while the category list is empty,
 * because a category ID we have never seen cannot be checked against the
 * Claims/Finance and Protect VAS locks. So this page shows the list and
 * marks what is locked — an empty table here is the reason the auto list
 * will not accept anything, stated in the place someone would look.
 *
 * READ-ONLY on purpose. Enabling the worker is a mode change, which lives
 * on the send-queue tab behind the emailed code.
 */
export function CourierPortalIndex(): ReactElement {
  const runs = useCourierPortalRuns();
  const taxonomy = useCourierTaxonomy();
  const channel = useCourierChannel();

  const rows = runs.data ?? [];
  const cats = taxonomy.data ?? [];
  const shadow = rows.filter((r) => r.mode === 'SHADOW').length;
  const failures = rows.filter((r) => r.outcome === 'FAILED' || r.outcome === 'CHALLENGED').length;

  return (
    <div>
      <PageHeader
        title="Portal worker"
        subtitle="The browser tier. It runs in a separate process from the API, and in SHADOW it reads and decides without writing anything."
      />
      <EscalationTabs />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Portal mode"
          value={channel.data?.settings.portalMode ?? '—'}
          hint="SHADOW reads and decides but never writes. Separate from the send-queue write mode."
        />
        <Stat
          label="Shadow runs recorded"
          value={String(shadow)}
          hint="Each one is a decision that was made and deliberately not acted on."
        />
        <Stat
          label="Failed or challenged"
          value={String(failures)}
          hint="A challenge freezes the worker rather than retrying — a login loop against a courier's portal is how an account gets locked."
        />
      </div>

      <Section
        title="Recent runs"
        subtitle="Newest first. A run is one visit with one purpose; the detail is what it saw or what it would have written."
      >
        {runs.isLoading ? (
          <SkeletonRows rows={4} cols={5} />
        ) : runs.isError ? (
          <ErrorNote message={serverVerdict(runs.error)} retry={() => void runs.refetch()} />
        ) : rows.length === 0 ? (
          <Card>
            <EmptyState
              title="The worker has not run"
              description="Expected: it is deployed inert and the nightly canary only runs once the portal credential exists. Nothing here is a fault yet."
            />
          </Card>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>When</Th>
                <Th>Doing</Th>
                <Th>Mode</Th>
                <Th>Outcome</Th>
                <Th>Detail</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="text-text-muted whitespace-nowrap">
                    {new Date(r.startedAt).toLocaleString('en-IN')}
                  </Td>
                  <Td className="whitespace-nowrap">{humanise(r.kind)}</Td>
                  <Td>
                    <StatusBadge
                      kind={r.mode === 'LIVE' ? 'in-transit' : 'draft'}
                      label={r.mode.toLowerCase()}
                    />
                  </Td>
                  <Td>
                    <StatusBadge kind={outcomeKind(r.outcome)} label={humanise(r.outcome)} />
                  </Td>
                  <Td className="max-w-lg">
                    {/* Verbatim, wrapped: a truncated failure detail is a
                        failure nobody can diagnose. */}
                    <pre className="text-text-muted whitespace-pre-wrap text-xs">
                      {r.detail ?? '—'}
                    </pre>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      <Section
        title="Delhivery's categories"
        subtitle="Fetched from their portal and kept by their own IDs. Two are locked to humans permanently — a claim and a paid-protection case are money, and no mode unlocks them."
      >
        {taxonomy.isLoading ? (
          <SkeletonRows rows={3} cols={4} />
        ) : taxonomy.isError ? (
          <ErrorNote
            message={serverVerdict(taxonomy.error)}
            retry={() => void taxonomy.refetch()}
          />
        ) : cats.length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-sm font-medium">Not fetched yet</p>
              <p className="text-text-muted mt-1 text-sm">
                This is why unattended action is refused: with no category IDs on file, none can be
                checked against the locked list, so the safe answer to &ldquo;may the worker file
                this?&rdquo; is no. The list fills on the worker&apos;s first successful visit.
              </p>
            </CardBody>
          </Card>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Their ID</Th>
                <Th>Category</Th>
                <Th>Unattended</Th>
                <Th>Last seen</Th>
              </Tr>
            </THead>
            <TBody>
              {cats.map((c) => (
                <Tr key={c.externalId}>
                  <Td className="whitespace-nowrap font-mono text-xs">{c.externalId}</Td>
                  <Td>{c.label}</Td>
                  <Td>
                    {c.isHumanOnly ? (
                      <span className="text-warning inline-flex items-center gap-1 text-xs">
                        <Lock size={12} /> human only
                      </span>
                    ) : (
                      <span className="text-text-muted text-xs">allowed if listed</span>
                    )}
                  </Td>
                  <Td className="text-text-muted whitespace-nowrap">
                    {new Date(c.lastSeenAt).toLocaleDateString('en-IN')}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </div>
  );
}

function outcomeKind(
  outcome: string,
): 'pending' | 'in-transit' | 'delivered' | 'failed' | 'draft' | 'cancelled' {
  switch (outcome) {
    case 'CONFIRMED':
    case 'ALREADY_PRESENT':
      return 'delivered';
    case 'SENT_UNVERIFIED':
      return 'pending';
    case 'FAILED':
    case 'CHALLENGED':
      return 'failed';
    case 'SKIPPED':
      return 'cancelled';
    default:
      return 'draft';
  }
}

function humanise(value: string): string {
  return value.toLowerCase().replace(/_/g, ' ');
}
