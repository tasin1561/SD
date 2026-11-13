'use client';

import { useState, type ReactElement } from 'react';
import { ChevronDown, FlaskConical, Github, RotateCcw, Sparkles, ThumbsDown } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TableEmpty, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { useToast } from '@skydrop/ui/app/toast';
import { useT } from '@/i18n/client';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { AcAlert, AcSection } from '../../settings/_components/ac-parts';
import {
  useApproveRec,
  useCheckRec,
  useDraftRecs,
  useGithubIssue,
  useKnowledgeVersions,
  useRecommendation,
  useRecommendations,
  useRejectRec,
  useRollbackKnowledge,
  type RecFilter,
  type RecItem,
} from '../_lib/ai-hooks';
import {
  CheckTable,
  CopyButton,
  DiffView,
  EvidenceLinks,
  STATUS_KIND,
  Verbatim,
} from './ai-recommendation-parts';

const FILTERS: ReadonlyArray<{ id: RecFilter | 'all'; status?: string }> = [
  { id: 'all' },
  { id: 'new', status: 'NEW' },
  { id: 'approved', status: 'APPROVED' },
  { id: 'live', status: 'LIVE' },
  { id: 'rejected', status: 'REJECTED' },
  { id: 'rolled_back', status: 'ROLLED_BACK' },
];

function RecCard({
  item,
  githubAvailable,
  liveVersionId,
}: {
  readonly item: RecItem;
  readonly githubAvailable: boolean;
  readonly liveVersionId: string | null;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const may = usePermission('assistant.conversations.read');
  const [open, setOpen] = useState(false);
  // The full per-case results are only fetched once the card is opened.
  const detail = useRecommendation(item.id, open);
  const view = detail.data ?? item;
  const check = view.check;
  const checkM = useCheckRec();
  const approveM = useApproveRec();
  const rejectM = useRejectRec();
  const issueM = useGithubIssue();
  void liveVersionId;

  const fail = (e: unknown): void => void toast.error(serverVerdict(e));
  const isKnowledge = view.kind === 'KNOWLEDGE';
  const open_ = view.status === 'NEW';
  const running = check?.status === 'RUNNING';
  const green = check?.status === 'DONE' && check.passed === true && !check.stale;

  return (
    <article className="ai-rec" data-open={open ? '1' : '0'} data-status={view.status}>
      <button
        type="button"
        className="ai-rec__head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ai-rec__titlewrap">
          <span className="ai-rec__title">{view.title}</span>
          <span className="ai-rec__theme">
            {t(`ai.rec.themeKind.${view.theme.kind}`)}: {view.theme.label}
          </span>
        </span>
        <span className="ai-rec__chips">
          <StatusChip
            kind={isKnowledge ? 'pending' : 'draft'}
            label={t(isKnowledge ? 'ai.rec.kind.knowledge' : 'ai.rec.kind.system')}
            size="sm"
          />
          <StatusChip
            kind={STATUS_KIND[view.status]}
            label={t(`ai.rec.status.${view.status}`)}
            size="sm"
          />
        </span>
        <ChevronDown className="ai-rec__chev" size={18} aria-hidden />
      </button>

      <div className="ai-rec__body" aria-hidden={!open}>
        <div className="ai-rec__inner">
          <p className="ai-rec__problem">{view.problem}</p>

          <h4>{t('ai.rec.evidence')}</h4>
          <EvidenceLinks ids={view.evidence} may={may} />

          {isKnowledge && view.diff !== null && (
            <>
              <h4>{t('ai.rec.draftVerbatim')}</h4>
              <AcAlert tone="warn" message={t('ai.rec.checkClaims')} />
              <DiffView before={view.diff.before} after={view.diff.after} />
            </>
          )}

          {!isKnowledge && view.system !== null && (
            <>
              <h4>{t('ai.rec.suggested')}</h4>
              <Verbatim text={view.system.suggestedChange} />
              <h4>{t('ai.rec.acceptance')}</h4>
              <Verbatim text={view.system.acceptanceCheck} />
              {view.task !== null && (
                <>
                  <h4>{t('ai.rec.task')}</h4>
                  <Verbatim text={view.task} />
                  <div className="ai-actions">
                    <CopyButton text={view.task} />
                    {githubAvailable && view.githubIssueUrl === null && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Github size={14} />}
                        loading={issueM.isPending}
                        onClick={() =>
                          issueM.mutate(view.id, {
                            onSuccess: () => toast.success(t('ai.rec.issueMade')),
                            onError: fail,
                          })
                        }
                      >
                        {t('ai.rec.issue')}
                      </Button>
                    )}
                    {view.githubIssueUrl !== null && (
                      <a
                        className="ai-link"
                        href={view.githubIssueUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {t('ai.rec.issueOpen')}
                      </a>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {isKnowledge && (
            <>
              <h4>{t('ai.rec.check')}</h4>
              {check === null ? (
                <p className="ai-note">{t('ai.rec.noCheck')}</p>
              ) : (
                <div className="ai-rec__checkline" aria-live="polite">
                  <StatusChip
                    kind={running ? 'pending' : green ? 'delivered' : 'failed'}
                    label={
                      running
                        ? t('ai.rec.running')
                        : green
                          ? t('ai.rec.passed')
                          : check.stale && check.passed
                            ? t('ai.rec.stale')
                            : t('ai.rec.notPassed')
                    }
                    size="sm"
                  />
                  <span className="ai-note">
                    {t('ai.rec.checkCounts', { n: check.total, r: check.regressions })}
                    {check.note ? ` — ${check.note}` : ''}
                  </span>
                </div>
              )}
              {check?.results !== undefined && check.results.length > 0 && (
                <div className="ai-rec__table">
                  <CheckTable results={check.results} />
                </div>
              )}
            </>
          )}

          {open_ || (view.kind === 'SYSTEM' && view.status === 'APPROVED') ? (
            <div className="ai-actions ai-rec__actions">
              {isKnowledge && open_ && (
                <Button
                  variant="secondary"
                  icon={<FlaskConical size={16} />}
                  loading={checkM.isPending || running}
                  onClick={() =>
                    checkM.mutate(view.id, {
                      onSuccess: () => toast.success(t('ai.rec.checkQueued')),
                      onError: fail,
                    })
                  }
                >
                  {t('ai.rec.runCheck')}
                </Button>
              )}
              {open_ && (
                <Button
                  variant="primary"
                  loading={approveM.isPending}
                  disabled={isKnowledge && !green}
                  onClick={() =>
                    approveM.mutate(view.id, {
                      onSuccess: () => toast.success(t('ai.rec.approved')),
                      onError: fail,
                    })
                  }
                >
                  {t(isKnowledge ? 'ai.rec.approveLive' : 'ai.rec.approve')}
                </Button>
              )}
              <Button
                variant="ghost"
                icon={<ThumbsDown size={16} />}
                loading={rejectM.isPending}
                onClick={() =>
                  rejectM.mutate(view.id, {
                    onSuccess: () => toast.success(t('ai.rec.rejected')),
                    onError: fail,
                  })
                }
              >
                {t('ai.rec.reject')}
              </Button>
              {isKnowledge && open_ && !green && (
                <span className="ai-note">{t('ai.rec.approveNeedsCheck')}</span>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function VersionHistoryCard(): ReactElement {
  const t = useT();
  const toast = useToast();
  const q = useKnowledgeVersions();
  const rollback = useRollbackKnowledge();
  const d = q.data;
  if (d === undefined) return <Skeleton height={120} />;
  const go = (versionId: string | null): void =>
    rollback.mutate(
      { versionId, expectedLive: d.liveVersionId },
      {
        onSuccess: () => toast.success(t('ai.rec.rolledBack')),
        onError: (e) => toast.error(serverVerdict(e)),
      },
    );
  const everLive = new Set(d.changes.map((c) => c.toVersionId));
  return (
    <Table caption={t('ai.rec.versions')}>
      <THead>
        <Tr>
          <Th>{t('ai.rec.version')}</Th>
          <Th>{t('ai.rec.contents')}</Th>
          <Th>{t('ai.rec.wentLive')}</Th>
          <Th>{t('ai.rec.state')}</Th>
          <Th align="right"> </Th>
        </Tr>
      </THead>
      <TBody>
        <Tr>
          <Td>{t('ai.rec.baseVersion')}</Td>
          <Td>{t('ai.rec.baseNote')}</Td>
          <Td>—</Td>
          <Td>
            {d.liveVersionId === null && (
              <StatusChip kind="delivered" label={t('ai.rec.liveNow')} size="sm" />
            )}
          </Td>
          <Td align="right">
            {d.liveVersionId !== null && (
              <Button
                variant="secondary"
                size="sm"
                icon={<RotateCcw size={14} />}
                loading={rollback.isPending}
                onClick={() => go(null)}
              >
                {t('ai.rec.rollbackTo')}
              </Button>
            )}
          </Td>
        </Tr>
        {d.versions.length === 0 && <TableEmpty colSpan={5}>{t('ai.rec.noVersions')}</TableEmpty>}
        {d.versions.map((v) => (
          <Tr key={v.id}>
            <Td>v{v.number}</Td>
            <Td>
              {t('ai.rec.counts', {
                g: v.counts.guides,
                t: v.counts.glossary,
                a: v.counts.addenda,
              })}
            </Td>
            <Td>{v.wentLiveAt === null ? '—' : new Date(v.wentLiveAt).toLocaleString()}</Td>
            <Td>
              {v.live ? (
                <StatusChip kind="delivered" label={t('ai.rec.liveNow')} size="sm" />
              ) : everLive.has(v.id) ? (
                <StatusChip kind="draft" label={t('ai.rec.earlier')} size="sm" />
              ) : (
                <StatusChip kind="pending" label={t('ai.rec.neverLive')} size="sm" />
              )}
            </Td>
            <Td align="right">
              {!v.live && everLive.has(v.id) && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<RotateCcw size={14} />}
                  loading={rollback.isPending}
                  onClick={() => go(v.id)}
                >
                  {t('ai.rec.rollbackTo')}
                </Button>
              )}
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

/** /ai/recommendations: what Haiku drafted from the themes, for the owner to read, check and decide. */
export function AiRecommendations(): ReactElement {
  const t = useT();
  const toast = useToast();
  const [filter, setFilter] = useState<RecFilter | 'all'>('new');
  const q = useRecommendations(filter);
  const all = useRecommendations('all');
  const draft = useDraftRecs();
  const counts = all.data?.counts ?? {};

  if (q.isError) {
    return (
      <ErrorState
        title={t('ai.error')}
        message={serverVerdict(q.error)}
        retry={() => void q.refetch()}
      />
    );
  }

  return (
    <>
      <AcSection
        title={t('ai.rec.title')}
        note={t('ai.rec.note')}
        action={
          <Button
            variant="primary"
            size="sm"
            icon={<Sparkles size={14} />}
            loading={draft.isPending}
            onClick={() =>
              draft.mutate(undefined, {
                onSuccess: () => toast.success(t('ai.rec.draftQueued')),
                onError: (e) => toast.error(serverVerdict(e)),
              })
            }
          >
            {t('ai.rec.draftNow')}
          </Button>
        }
      >
        <div className="ai-rec__filters" role="tablist" aria-label={t('ai.rec.filters')}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className="ai-rec__filter"
              data-on={filter === f.id ? '1' : '0'}
              onClick={() => setFilter(f.id)}
            >
              {t(`ai.rec.filter.${f.id}`)}
              {f.status !== undefined && <small>{counts[f.status] ?? 0}</small>}
            </button>
          ))}
        </div>
        {q.data === undefined ? (
          <Skeleton height={200} />
        ) : q.data.items.length === 0 ? (
          <p className="ai-note">{t('ai.rec.empty')}</p>
        ) : (
          <div className="ai-rec__list">
            {q.data.items.map((i) => (
              <RecCard
                key={i.id}
                item={i}
                githubAvailable={q.data.githubAvailable}
                liveVersionId={q.data.liveVersionId}
              />
            ))}
          </div>
        )}
      </AcSection>

      <AcSection title={t('ai.rec.versions')} note={t('ai.rec.versionsNote')} flush>
        <VersionHistoryCard />
      </AcSection>
    </>
  );
}
