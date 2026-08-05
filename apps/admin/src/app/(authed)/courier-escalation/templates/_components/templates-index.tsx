'use client';

import { useState, type ReactElement } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorNote,
  FormField,
  Input,
  PageHeader,
  Section,
  SkeletonRows,
  StatusBadge,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import {
  useCourierTemplateCandidates,
  useCourierTemplates,
  usePromoteCandidate,
  useRejectCandidate,
  type CourierTemplateCandidate,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { EscalationTabs } from '../../_components/escalation-tabs';

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
    <div>
      <PageHeader
        title="Message patterns"
        subtitle="Courier messages the library could not classify, and the live patterns it matches with. A pattern decides what a seller is told a message means."
      />
      <EscalationTabs />

      <Section
        title="Awaiting review"
        subtitle="Most-repeated first — the pattern worth writing next is at the top."
      >
        {candidates.isLoading ? (
          <SkeletonRows rows={3} cols={1} />
        ) : candidates.isError ? (
          <ErrorNote
            message={serverVerdict(candidates.error)}
            retry={() => void candidates.refetch()}
          />
        ) : pending.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing unmatched"
              description="Either every message so far matched a pattern, or none have arrived yet. Both are fine; this queue fills itself."
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map((c) => (
              <CandidateCard key={c.id} candidate={c} canWrite={canWrite} />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="The live library"
        subtitle="Checked in this order — the first match wins, so a broad pattern with a low number can shadow a precise one below it."
      >
        {templates.isLoading ? (
          <SkeletonRows rows={4} cols={5} />
        ) : templates.isError ? (
          <ErrorNote
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
                  <Td align="right">{t.priority}</Td>
                  <Td className="whitespace-nowrap font-medium">{t.code}</Td>
                  <Td>
                    <code className="text-text-muted break-all text-xs">{t.pattern}</code>
                  </Td>
                  <Td className="whitespace-nowrap">{humanise(t.state)}</Td>
                  <Td className="text-text-muted whitespace-nowrap text-xs">
                    {t.action === null ? '—' : humanise(t.action)}
                  </Td>
                  <Td>
                    <StatusBadge
                      kind={t.isActive ? 'delivered' : 'draft'}
                      label={t.isActive ? 'active' : 'off'}
                    />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      {reviewed.length > 0 ? (
        <Section
          title="Already decided"
          subtitle="Kept rather than deleted: the body is the evidence for why a pattern exists, and a pattern whose origin was thrown away is one nobody can safely change later."
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
                  <Td className="max-w-xl">
                    <div className="truncate text-xs">{c.body}</div>
                  </Td>
                  <Td align="right">{c.seenCount}</Td>
                  <Td>
                    <StatusBadge
                      kind={c.status === 'PROMOTED' ? 'delivered' : 'cancelled'}
                      label={c.status.toLowerCase()}
                    />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Section>
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

  const submit = (): void => {
    void (async () => {
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
      }
    })();
  };

  const dismiss = (): void => {
    void (async () => {
      try {
        await reject.mutateAsync({ candidateId: candidate.id });
        toast.success('Left out of the library');
      } catch (err) {
        toast.error(serverVerdict(err));
      }
    })();
  };

  return (
    <Card>
      <CardBody>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
          <span className="font-medium">
            seen {candidate.seenCount} {candidate.seenCount === 1 ? 'time' : 'times'}
          </span>
          <span className="text-text-muted">
            first {new Date(candidate.firstSeenAt).toLocaleDateString('en-IN')}, last{' '}
            {new Date(candidate.lastSeenAt).toLocaleDateString('en-IN')}
          </span>
        </div>

        {/* The body a pattern must match, shown in full and verbatim —
            a truncated body is one you cannot write a regex against. */}
        <pre className="bg-surface-2 mb-3 whitespace-pre-wrap rounded p-3 text-sm">
          {candidate.body}
        </pre>

        {canWrite ? (
          open ? (
            <div className="border-border flex flex-col gap-3 border-t pt-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Code" hint="Stable, e.g. NDR_ACK_24_48." htmlFor={fid('code')}>
                  <Input id={fid('code')} value={code} onChange={(e) => setCode(e.target.value)} />
                </FormField>
                <FormField
                  label="Means"
                  hint="The state this implies, e.g. ACKNOWLEDGED."
                  htmlFor={fid('state')}
                >
                  <Input
                    id={fid('state')}
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                  />
                </FormField>
                <FormField
                  label="Action"
                  hint="Optional, e.g. ASK_SELLER_ALT_PHONE."
                  htmlFor={fid('action')}
                >
                  <Input
                    id={fid('action')}
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                  />
                </FormField>
                <FormField label="Order" hint="Lower is checked first." htmlFor={fid('priority')}>
                  <Input
                    id={fid('priority')}
                    inputMode="numeric"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  />
                </FormField>
              </div>
              <FormField
                label="Pattern"
                hint="A regular expression without delimiters, matched case-insensitively. The server refuses one that does not match the message above."
                htmlFor={fid('pattern')}
              >
                <Input
                  id={fid('pattern')}
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                />
              </FormField>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={submit}
                  disabled={code.trim() === '' || pattern.trim() === '' || state.trim() === ''}
                >
                  <CheckCircle2 size={14} /> Make it live
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
                Write a pattern
              </Button>
              <Button variant="ghost" size="sm" onClick={dismiss}>
                <XCircle size={14} /> Not worth one
              </Button>
            </div>
          )
        ) : null}
      </CardBody>
    </Card>
  );
}

function humanise(value: string): string {
  return value.toLowerCase().replace(/_/g, ' ');
}
