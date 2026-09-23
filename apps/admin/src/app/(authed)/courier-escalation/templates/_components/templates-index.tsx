'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';
// The legacy `useToast` stays: the FE-2 test mounts this page under the
// legacy Toaster only.
import { useToast } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextField } from '@skydrop/ui/app/text-field';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, Td, THead, Th, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import {
  useCourierTemplateCandidates,
  useCourierTemplates,
  usePromoteCandidate,
  useRejectCandidate,
  type CourierTemplateCandidate,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { AfCard, AfSection } from '@/app/(authed)/system/_components/af-parts';
import { EscalationTabs } from '../../_components/escalation-tabs';
import '../../_components/escalation.css';

/**
 * The promotion queue: unmatched courier messages becoming patterns.
 *
 * ── THIS SCREEN IS THE MECHANISM ─────────────────────────────────────
 * The classifier is a regex library seeded from four real Delhivery
 * messages, and the plan for growing it is: record what it could not
 * match, and have a human turn the recurring ones into patterns. Until
 * this page existed the recording half ran and the human half had no way
 * in — so the library could never have grown, and the pressure would
 * eventually have gone on switching the LLM on to paper over a gap
 * nobody had actually looked at.
 *
 * ── MOST-REPEATED FIRST ──────────────────────────────────────────────
 * The order is the whole value: a message seen forty times is forty
 * future classifications, and one seen once is probably a person typing
 * freehand. The count is shown so the reviewer can tell those apart.
 *
 * ── A SUGGESTION IS NOT A DECISION ───────────────────────────────────
 * `suggestedRegex` is prefilled and always editable, and the server
 * refuses a pattern that does not match the body it came from. That check
 * is on the server because it is the one mistake that would otherwise
 * look like a successful promotion.
 */
export function CourierTemplatesIndex(): ReactElement {
  const candidates = useCourierTemplateCandidates();
  const templates = useCourierTemplates();
  // FE-2: cosmetic. Promotion is refused server-side without this.
  const canWrite = usePermission('courier.ops.write');

  const pending = (candidates.data ?? []).filter((c) => c.status === 'PENDING');
  const reviewed = (candidates.data ?? []).filter((c) => c.status !== 'PENDING');

  return (
    <div className="af-page">
      <PageHeader
        breadcrumbs={[{ label: 'Network' }, { label: 'Courier escalation' }]}
        Link={Link}
        title="Message patterns"
        subtitle="Courier messages the library could not classify, and the live patterns it matches with. A pattern decides what a seller is told a message means."
      />
      <EscalationTabs />

      <AfSection
        title="Awaiting review"
        note="Most-repeated first — the pattern worth writing next is at the top."
      >
        {candidates.isLoading ? (
          <SkeletonRows rows={3} cols={1} label="Loading candidates" />
        ) : candidates.isError ? (
          <ErrorState
            message={serverVerdict(candidates.error)}
            retry={() => void candidates.refetch()}
          />
        ) : pending.length === 0 ? (
          <EmptyState
            tone="positive"
            title="Nothing unmatched"
            description="Either every message so far matched a pattern, or none have arrived yet. Both are fine; this queue fills itself."
          />
        ) : (
          <div className="af-stack">
            {pending.map((c) => (
              <CandidateCard key={c.id} candidate={c} canWrite={canWrite} />
            ))}
          </div>
        )}
      </AfSection>

      <AfSection
        title="The live library"
        note="Checked in this order — the first match wins, so a broad pattern with a low number can shadow a precise one below it."
      >
        {templates.isLoading ? (
          <AfCard flush>
            <SkeletonRows rows={4} cols={5} label="Loading patterns" />
          </AfCard>
        ) : templates.isError ? (
          <ErrorState
            message={serverVerdict(templates.error)}
            retry={() => void templates.refetch()}
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th align="right">Order</Th>
                <Th>Code</Th>
                <Th>Pattern</Th>
                <Th>Means</Th>
                <Th>Action</Th>
                <Th>Live</Th>
              </Tr>
            </THead>
            <TBody>
              {(templates.data ?? []).map((t) => (
                <Tr key={t.id}>
                  <Td align="right">
                    <span className="sk-figure">{t.priority}</span>
                  </Td>
                  <Td>
                    <span className="af-strong sk-ident af-nowrap">{t.code}</span>
                  </Td>
                  <Td>
                    <code className="af-code">{t.pattern}</code>
                  </Td>
                  <Td>
                    <span className="af-nowrap">{humanise(t.state)}</span>
                  </Td>
                  <Td>
                    <span className="af-small af-nowrap">
                      {t.action === null ? '—' : humanise(t.action)}
                    </span>
                  </Td>
                  <Td>
                    <StatusChip
                      size="sm"
                      kind={t.isActive ? 'delivered' : 'draft'}
                      label={t.isActive ? 'active' : 'off'}
                    />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </AfSection>

      {reviewed.length > 0 ? (
        <AfSection
          title="Already decided"
          note="Kept rather than deleted: the body is the evidence for why a pattern exists, and a pattern whose origin was thrown away is one nobody can safely change later."
        >
          <Table>
            <THead>
              <Tr>
                <Th>Message</Th>
                <Th align="right">Seen</Th>
                <Th>Outcome</Th>
              </Tr>
            </THead>
            <TBody>
              {reviewed.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <span className="af-clip af-small" title={c.body}>
                      {c.body}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="sk-figure">{c.seenCount}</span>
                  </Td>
                  <Td>
                    <StatusChip
                      size="sm"
                      kind={c.status === 'PROMOTED' ? 'delivered' : 'cancelled'}
                      label={c.status.toLowerCase()}
                    />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </AfSection>
      ) : null}
    </div>
  );
}

function CandidateCard({
  candidate,
  canWrite,
}: {
  readonly candidate: CourierTemplateCandidate;
  readonly canWrite: boolean;
}): ReactElement {
  const toast = useToast();
  const promote = usePromoteCandidate();
  const reject = useRejectCandidate();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [pattern, setPattern] = useState(candidate.suggestedRegex ?? '');
  const [state, setState] = useState(candidate.suggestedState ?? '');
  const [action, setAction] = useState('');
  const [priority, setPriority] = useState('50');
  // Ids are per-candidate: several cards render at once, so a bare
  // id="code" would point every label at the first card's input.
  const fid = (name: string): string => `${candidate.id}-${name}`;

  const submit = async (): Promise<void> => {
    try {
      await promote.mutateAsync({
        candidateId: candidate.id,
        code: code.trim(),
        pattern,
        state: state.trim(),
        ...(action.trim() === '' ? {} : { action: action.trim() }),
        ...(Number.isFinite(Number(priority)) ? { priority: Number(priority) } : {}),
      });
      toast.success('Pattern is live');
      setOpen(false);
    } catch (err) {
      // FE-2: PATTERN_DOES_NOT_MATCH and PATTERN_INVALID arrive from the
      // server and are shown as they came.
      toast.error(serverVerdict(err));
      throw err;
    }
  };

  const dismiss = async (): Promise<void> => {
    try {
      await reject.mutateAsync({ candidateId: candidate.id });
      toast.success('Left out of the library');
    } catch (err) {
      toast.error(serverVerdict(err));
      throw err;
    }
  };

  return (
    <AfCard>
      <div className="ce-candidate__meta">
        <span className="af-strong">
          seen {candidate.seenCount} {candidate.seenCount === 1 ? 'time' : 'times'}
        </span>
        <span className="af-small">
          first {new Date(candidate.firstSeenAt).toLocaleDateString('en-IN')}, last{' '}
          {new Date(candidate.lastSeenAt).toLocaleDateString('en-IN')}
        </span>
      </div>

      {/* The body a pattern must match, shown in full and verbatim —
          a truncated body is one you cannot write a regex against. */}
      <pre className="af-pre">{candidate.body}</pre>

      {canWrite ? (
        open ? (
          <div className="af-divider af-form">
            <div className="af-grid-2">
              <TextField
                id={fid('code')}
                label="Code"
                hint="Stable, e.g. NDR_ACK_24_48."
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <TextField
                id={fid('state')}
                label="Means"
                hint="The state this implies, e.g. ACKNOWLEDGED."
                value={state}
                onChange={(e) => setState(e.target.value)}
              />
              <TextField
                id={fid('action')}
                label="Action"
                hint="Optional, e.g. ASK_SELLER_ALT_PHONE."
                value={action}
                onChange={(e) => setAction(e.target.value)}
              />
              <TextField
                id={fid('priority')}
                label="Order"
                hint="Lower is checked first."
                inputMode="numeric"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </div>
            <TextField
              id={fid('pattern')}
              label="Pattern"
              hint="A regular expression without delimiters, matched case-insensitively. The server refuses one that does not match the message above."
              inputClassName="af-code"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            />
            <div className="af-row">
              <AsyncButton
                variant="primary"
                size="sm"
                icon={<CheckCircle2 size={14} />}
                labels={{
                  idle: 'Make it live',
                  busy: 'Promoting…',
                  done: 'Live',
                  error: 'Refused',
                }}
                disabled={code.trim() === '' || pattern.trim() === '' || state.trim() === ''}
                onAction={submit}
              />
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="af-row">
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              Write a pattern
            </Button>
            <AsyncButton
              variant="ghost"
              size="sm"
              icon={<XCircle size={14} />}
              labels={{ idle: 'Not worth one', busy: 'Leaving out…', done: 'Left out' }}
              onAction={dismiss}
            />
          </div>
        )
      ) : null}
    </AfCard>
  );
}

function humanise(value: string): string {
  return value.toLowerCase().replace(/_/g, ' ');
}
