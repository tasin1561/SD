import { Injectable } from '@nestjs/common';
import { isPublicAwb, type PublicParcelReader } from '../assistant-public-parcel';
import { detectReplyLanguage, noticeText } from '../assistant-language';
import type { AssistantStreamEvent, CallerScope } from '../assistant.types';
import { PublicTrackingReadService } from '../../tracking-public/services/public-tracking-read.service';
import { AssistantBudgetService } from './assistant-budget.service';
import { AssistantChatService } from './assistant-chat.service';
import { AssistantStoreService } from './assistant-store.service';

/**
 * The public parcel helper's front door (assistant Batch C).
 *
 * One AWB per conversation, and the AWB comes from the tracking page's own
 * route, never from the visitor's words. The chat itself is the SAME
 * `AssistantChatService.send` every console uses, with a PUBLIC scope: the
 * budget gate, the notices, the usage rows, the monitor and the 7-day
 * deletion all apply without a second pipeline. What is different is what
 * the scope allows: one tool (`get_parcel`, no input), no page context, no
 * attachments, no ticket.
 *
 * Unknown AWB: this asks `PublicTrackingReadService.findByAwb` first, the
 * page's own lookup, and lets ITS generic 404 through. A malformed AWB is
 * answered by the same call with an empty string, so no input is told apart
 * from a missing parcel, and nothing is created for either.
 */
@Injectable()
export class AssistantPublicService {
  constructor(
    private readonly parcels: PublicTrackingReadService,
    private readonly budget: AssistantBudgetService,
    private readonly store: AssistantStoreService,
    private readonly chat: AssistantChatService,
  ) {}

  /** Should the page show the helper at all? (switch on, key set, under budget) */
  async available(): Promise<boolean> {
    return this.budget.publicAvailable();
  }

  /**
   * Throws the page's own generic 404 unless the parcel exists. Returns the
   * AWB exactly as the page's lookup normalises it.
   */
  async requireParcel(awbRaw: unknown): Promise<string> {
    const reader: PublicParcelReader = this.parcels;
    if (!isPublicAwb(awbRaw)) {
      // `findByAwb('')` is the page's own "nothing to look up" 404: the same
      // body as an unknown number, with no database read.
      await reader.findByAwb('');
      throw new Error('unreachable');
    }
    const awb = awbRaw.trim();
    await reader.findByAwb(awb);
    return awb;
  }

  scopeFor(awb: string, visitorKey: string): CallerScope {
    return {
      audience: 'PUBLIC',
      userId: visitorKey,
      sellerId: null,
      storeId: null,
      orderScope: null,
      permissions: [],
      impersonatingStaffId: null,
      publicAwb: awb,
    };
  }

  async send(
    awb: string,
    visitorKey: string,
    conversationId: string | undefined,
    text: string,
    emit: (event: AssistantStreamEvent) => void,
  ): Promise<void> {
    const scope = this.scopeFor(awb, visitorKey);
    let id = conversationId;
    if (id === undefined) {
      // Switched off or over budget: say so politely and create nothing.
      if (!(await this.budget.publicAvailable())) {
        emit({
          type: 'notice',
          code: 'PUBLIC_UNAVAILABLE',
          text: noticeText('PUBLIC_UNAVAILABLE', detectReplyLanguage(text)),
          helpLinks: [],
        });
        emit({ type: 'done', conversationId: '' });
        return;
      }
      id = (await this.store.createConversation(scope, null)).id;
    }
    await this.chat.send(scope, id, text, emit, null, []);
  }

  /** 404 unless this visitor's key owns that conversation, on THIS parcel. */
  async requireConversation(awb: string, visitorKey: string, id: string): Promise<void> {
    await this.chat.requireOwned(this.scopeFor(awb, visitorKey), id);
  }
}
