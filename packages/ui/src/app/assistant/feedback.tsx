'use client';

import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import type { Translate } from '../i18n';
import type { UiMessageKey } from '../i18n/ui-messages';
import type { AssistantTransport } from './index';

export type AnswerRating = 'up' | 'down';
export const MAX_FEEDBACK_COMMENT = 500;

/**
 * Thumbs under one assistant answer. A rating is saved at once; a thumbs-down
 * also opens an OPTIONAL "what was wrong?" box (500 characters). Pressing the
 * same thumb again takes the rating back. Owner-only on the server, never sent
 * to the model and it never changes the conversation. The control is quiet
 * (muted icons, no motion beyond a colour change) and a failure is a short
 * line, never a blocker.
 */
export function AnswerFeedback({
  base,
  conversationId,
  messageId,
  initial,
  transport,
  t,
}: {
  readonly base: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly initial?: AnswerRating | undefined;
  readonly transport: AssistantTransport;
  readonly t: Translate<UiMessageKey>;
}): ReactElement {
  const [rating, setRating] = useState<AnswerRating | null>(initial ?? null);
  const [asking, setAsking] = useState(false);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async (next: AnswerRating | 'none', text?: string): Promise<boolean> => {
    setBusy(true);
    setFailed(false);
    try {
      await transport.request(`${base}/conversations/${conversationId}/feedback`, {
        method: 'POST',
        body: {
          messageId,
          rating: next,
          ...(text !== undefined && text !== '' ? { comment: text } : {}),
        },
      });
      return true;
    } catch {
      setFailed(true);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const press = async (which: AnswerRating): Promise<void> => {
    if (busy) return;
    if (rating === which) {
      if (await save('none')) {
        setRating(null);
        setAsking(false);
        setSent(false);
      }
      return;
    }
    if (await save(which)) {
      setRating(which);
      setSent(false);
      setAsking(which === 'down');
    }
  };

  const sendComment = async (): Promise<void> => {
    if (busy || comment.trim() === '') return;
    if (await save('down', comment.trim())) {
      setAsking(false);
      setSent(true);
    }
  };

  return (
    <div className="sk-ai-fb">
      <div className="sk-ai-fb__row" role="group" aria-label={t('ui.assistant.rateAnswer')}>
        <button
          type="button"
          className="sk-ai-fb__btn"
          data-on={rating === 'up' ? '1' : undefined}
          aria-pressed={rating === 'up'}
          aria-label={t('ui.assistant.thumbsUp')}
          title={t('ui.assistant.thumbsUp')}
          disabled={busy}
          onClick={() => void press('up')}
        >
          <ThumbsUp size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="sk-ai-fb__btn"
          data-on={rating === 'down' ? '1' : undefined}
          aria-pressed={rating === 'down'}
          aria-label={t('ui.assistant.thumbsDown')}
          title={t('ui.assistant.thumbsDown')}
          disabled={busy}
          onClick={() => void press('down')}
        >
          <ThumbsDown size={14} aria-hidden="true" />
        </button>
        {sent ? <span className="sk-ai-fb__note">{t('ui.assistant.feedbackThanks')}</span> : null}
        {failed ? (
          <span className="sk-ai-fb__note" role="status">
            {t('ui.assistant.feedbackFailed')}
          </span>
        ) : null}
      </div>
      {asking ? (
        <div className="sk-ai-fb__ask">
          <label>
            <span className="sk-ai-sr">{t('ui.assistant.feedbackWhat')}</span>
            <textarea
              className="sk-ai-fb__text"
              rows={2}
              maxLength={MAX_FEEDBACK_COMMENT}
              value={comment}
              placeholder={t('ui.assistant.feedbackWhat')}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          <div className="sk-ai-fb__acts">
            <span className="sk-ai-fb__count">
              {comment.length}/{MAX_FEEDBACK_COMMENT}
            </span>
            <button type="button" className="sk-ai-fb__skip" onClick={() => setAsking(false)}>
              {t('ui.assistant.feedbackSkip')}
            </button>
            <button
              type="button"
              className="sk-ai-cta"
              disabled={busy || comment.trim() === ''}
              onClick={() => void sendComment()}
            >
              {t('ui.assistant.feedbackSend')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
