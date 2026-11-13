'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { Download, Eye, ThumbsDown, ThumbsUp, Wrench } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { useToast } from '@skydrop/ui/app/toast';
import { useT } from '@/i18n/client';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { AcAlert, AcCard, AcSection } from '../../settings/_components/ac-parts';
import { MonitorCard } from './ai-monitor-parts';
import {
  useAttachmentDownload,
  useOpenConversation,
  useRevealMessage,
  type ReviewBlock,
} from '../_lib/ai-hooks';

function Block({ b }: { readonly b: ReviewBlock }): ReactElement | null {
  const t = useT();
  if (b.type === 'text') return <p className="ai-text">{b.text}</p>;
  if (b.type === 'file')
    return <p className="ai-file">{t('ai.conv.fileInTurn', { kind: b.kind })}</p>;
  const body = JSON.stringify(b.type === 'tool_use' ? b.input : b.content, null, 2);
  return (
    <details className="ai-tool">
      <summary>
        <Wrench size={13} aria-hidden />
        {b.type === 'tool_use' ? t('ai.conv.toolCall', { name: b.name }) : t('ai.conv.toolResult')}
        {b.type === 'tool_result' && !b.ok && (
          <StatusChip kind="failed" label={t('ai.conv.toolFailed')} size="sm" />
        )}
      </summary>
      <pre>{body}</pre>
    </details>
  );
}

/** One conversation, full transcript. Opening it is recorded in the audit log by the server before the data comes back. */
export function AiConversationDetail({ id }: { readonly id: string }): ReactElement {
  const t = useT();
  const toast = useToast();
  const may = usePermission('assistant.conversations.read');
  const q = useOpenConversation(id);
  const reveal = useRevealMessage(id);
  const download = useAttachmentDownload(id);
  const [revealed, setRevealed] = useState<Record<string, readonly ReviewBlock[]>>({});

  if (!may) return <AcAlert tone="warn" message={t('ai.conv.noAccess')} />;
  if (q.isError) return <ErrorState title={t('ai.error')} message={serverVerdict(q.error)} />;
  if (q.data === undefined) return <Skeleton height={360} />;
  const c = q.data;

  return (
    <>
      <p>
        <Link href="/ai/conversations" className="ai-link">
          ← {t('ai.tab.conversations')}
        </Link>
      </p>
      <AcAlert tone="warn" message={t('ai.conv.openRecorded')} />
      <AcCard title={c.conversation.user ?? '—'} note={c.conversation.account ?? undefined}>
        <div className="ai-meta">
          <StatusChip kind="neutral" label={t(`ai.portal.${c.conversation.portal}`)} size="sm" />
          <span>{new Date(c.conversation.createdAt).toLocaleString()}</span>
          {c.conversation.anonymised && (
            <StatusChip kind="held" label={t('ai.conv.anonymised')} size="sm" />
          )}
        </div>
      </AcCard>

      {c.monitor !== null && <MonitorCard m={c.monitor} />}

      <AcSection title={t('ai.conv.transcript')}>
        <ol className="ai-thread">
          {c.messages.map((m) => {
            const blocks = revealed[m.id] ?? m.blocks;
            return (
              <li key={m.id} className="ai-turn" data-role={m.role}>
                <div className="ai-turn__meta">
                  <strong>
                    {m.role === 'user'
                      ? m.isQuestion
                        ? t('ai.conv.person')
                        : t('ai.conv.toolResults')
                      : t('ai.conv.assistant')}
                  </strong>
                  <time dateTime={m.at}>{new Date(m.at).toLocaleString()}</time>
                  {m.feedback.map((f, i) => (
                    <span key={i} className="ai-turn__fb" data-rating={f.rating}>
                      {f.rating === 'up' ? (
                        <ThumbsUp size={14} aria-label={t('ai.conv.thumbsUp')} />
                      ) : (
                        <ThumbsDown size={14} aria-label={t('ai.conv.thumbsDown')} />
                      )}
                      {f.comment}
                    </span>
                  ))}
                </div>
                <div className="ai-turn__body">
                  {blocks.map((b, i) => (
                    <Block key={i} b={b} />
                  ))}
                  {m.maskedPhones > 0 && revealed[m.id] === undefined && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Eye size={14} />}
                      loading={reveal.isPending && reveal.variables === m.id}
                      onClick={() =>
                        reveal.mutate(m.id, {
                          onSuccess: (r) => setRevealed((o) => ({ ...o, [m.id]: r.blocks })),
                          onError: (e) => toast.error(serverVerdict(e)),
                        })
                      }
                    >
                      {t('ai.conv.reveal')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </AcSection>

      {c.attachments.length > 0 && (
        <AcSection title={t('ai.conv.files')}>
          <ul className="ai-files">
            {c.attachments.map((a) => (
              <li key={a.id}>
                <span>{a.name}</span>
                <small>
                  {a.kind} · {Math.round(a.bytes / 1024)} KB
                  {a.pages !== null ? ` · ${a.pages}p` : ''}
                </small>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Download size={13} />}
                  disabled={!a.available}
                  onClick={() =>
                    download.mutate(a.id, {
                      onSuccess: (r) => window.open(r.url, '_blank', 'noopener'),
                      onError: (e) => toast.error(serverVerdict(e)),
                    })
                  }
                >
                  {a.available ? t('ai.conv.download') : t('ai.conv.removed')}
                </Button>
              </li>
            ))}
          </ul>
        </AcSection>
      )}

      {c.notices.length > 0 && (
        <AcSection title={t('ai.conv.noticesShown')}>
          <p>{c.notices.map((n) => n.code).join(', ')}</p>
        </AcSection>
      )}
    </>
  );
}
