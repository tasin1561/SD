import { Injectable, NotFoundException } from '@nestjs/common';
import type { CallerScope } from '../assistant.types';
import { AssistantStoreService } from './assistant-store.service';

/**
 * Thumbs up / down under an assistant answer. Owner-only: the answer must
 * sit in a conversation the caller owns (same ownership predicate as every
 * other read), one rating per answer per person, and nothing here is ever
 * sent to the model or changes the stored history.
 */
@Injectable()
export class AssistantFeedbackService {
  constructor(private readonly store: AssistantStoreService) {}

  async rate(
    scope: CallerScope,
    conversationId: string,
    messageId: string,
    rating: 'up' | 'down' | 'none',
    comment: string | undefined,
  ): Promise<{ rating: 'up' | 'down' | 'none' }> {
    const msg = await this.store.findOwnedAnswer(scope, messageId);
    // Someone else's answer, another conversation's, or none: the same 404.
    if (msg === null || msg.conversationId !== conversationId) {
      throw new NotFoundException({
        code: 'ASSISTANT_MESSAGE_NOT_FOUND',
        message: 'Answer not found',
      });
    }
    if (rating === 'none') {
      await this.store.removeFeedback(scope, messageId);
      return { rating };
    }
    const text = comment?.trim().slice(0, 500);
    await this.store.upsertFeedback(
      scope,
      msg,
      rating === 'up' ? 'UP' : 'DOWN',
      text === undefined || text === '' ? null : text,
    );
    return { rating };
  }
}
