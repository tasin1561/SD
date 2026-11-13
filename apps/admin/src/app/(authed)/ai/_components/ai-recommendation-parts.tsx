'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { Check, ClipboardCopy } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { useToast } from '@skydrop/ui/app/toast';
import { useT } from '@/i18n/client';
import type { GateCase, GateSide, RecStatus } from '../_lib/ai-hooks';

export const STATUS_KIND: Record<RecStatus, 'draft' | 'pending' | 'failed' | 'delivered' | 'rto'> =
  {
    NEW: 'draft',
    APPROVED: 'pending',
    REJECTED: 'failed',
    LIVE: 'delivered',
    ROLLED_BACK: 'rto',
  };

/** The text exactly as stored: monospace, wrapped, never reflowed or summarised. */
export function Verbatim({ text }: { readonly text: string }): ReactElement {
  return <pre className="ai-rec__verbatim">{text}</pre>;
}

/** Before / after of one change: lines only in "after" are added, lines only in "before" are removed. */
export function DiffView({
  before,
  after,
}: {
  readonly before: string | null;
  readonly after: string;
}): ReactElement {
  const t = useT();
  const b = (before ?? '').split('\n');
  const a = after.split('\n');
  const inB = new Set(b);
  const inA = new Set(a);
  return (
    <div className="ai-rec__diff">
      <div>
        <h4>{t('ai.rec.before')}</h4>
        {before === null ? (
          <p className="ai-note">{t('ai.rec.newEntry')}</p>
        ) : (
          <pre className="ai-rec__verbatim">
            {b.map((l, i) => (
              <span key={i} className="ai-diff__line" data-kind={inA.has(l) ? 'same' : 'del'}>
                {l}
                {'\n'}
              </span>
            ))}
          </pre>
        )}
      </div>
      <div>
        <h4>{t('ai.rec.after')}</h4>
        <pre className="ai-rec__verbatim">
          {a.map((l, i) => (
            <span key={i} className="ai-diff__line" data-kind={inB.has(l) ? 'same' : 'add'}>
              {l}
              {'\n'}
            </span>
          ))}
        </pre>
      </div>
    </div>
  );
}

export function CopyButton({ text }: { readonly text: string }): ReactElement {
  const t = useT();
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={done ? <Check size={14} /> : <ClipboardCopy size={14} />}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setDone(true);
            toast.success(t('ai.rec.copied'));
            window.setTimeout(() => setDone(false), 1800);
          },
          () => toast.error(t('ai.rec.copyFailed')),
        );
      }}
    >
      {t('ai.rec.copy')}
    </Button>
  );
}

const SIDE_KIND: Record<GateSide['status'], 'delivered' | 'failed' | 'pending'> = {
  pass: 'delivered',
  fail: 'failed',
  error: 'pending',
};
const OUTCOME_KIND: Record<GateCase['outcome'], 'delivered' | 'failed' | 'draft' | 'pending'> = {
  same_pass: 'delivered',
  same_fail: 'draft',
  improved: 'delivered',
  regressed: 'failed',
};

/** The per-case result table of one check: live next to draft, the regressions first. */
export function CheckTable({ results }: { readonly results: readonly GateCase[] }): ReactElement {
  const t = useT();
  const order = { regressed: 0, improved: 1, same_fail: 2, same_pass: 3 } as const;
  const rows = [...results].sort((x, y) => order[x.outcome] - order[y.outcome]);
  return (
    <Table caption={t('ai.rec.checkTable')}>
      <THead>
        <Tr>
          <Th>{t('ai.rec.case')}</Th>
          <Th>{t('ai.rec.live')}</Th>
          <Th>{t('ai.rec.draft')}</Th>
          <Th>{t('ai.rec.result')}</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <Tr key={r.id}>
            <Td>
              <div className="ai-rec__case">
                <strong>{r.id}</strong>
                <span>{r.question}</span>
                {r.draft.status !== 'pass' && r.draft.detail !== '' && (
                  <small>{r.draft.detail}</small>
                )}
              </div>
            </Td>
            <Td>
              <StatusChip
                kind={SIDE_KIND[r.live.status]}
                label={t(`ai.rec.side.${r.live.status}`)}
                size="sm"
              />
            </Td>
            <Td>
              <StatusChip
                kind={SIDE_KIND[r.draft.status]}
                label={t(`ai.rec.side.${r.draft.status}`)}
                size="sm"
              />
            </Td>
            <Td>
              <StatusChip
                kind={OUTCOME_KIND[r.outcome]}
                label={t(`ai.rec.out.${r.outcome}`)}
                size="sm"
              />
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

export function EvidenceLinks({
  ids,
  may,
}: {
  readonly ids: readonly string[];
  readonly may: boolean;
}): ReactElement {
  const t = useT();
  if (ids.length === 0) return <p className="ai-note">{t('ai.rec.noEvidence')}</p>;
  return (
    <ul className="ai-rec__ids">
      {ids.slice(0, 20).map((id) => (
        <li key={id}>
          {may ? (
            <Link href={`/ai/conversations/${id}`} className="ai-link">
              {id}
            </Link>
          ) : (
            id
          )}
        </li>
      ))}
    </ul>
  );
}
