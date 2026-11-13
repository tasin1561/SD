import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { SellerSelfService } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { MAX_ATTACHMENT_BYTES } from '../assistant-attachment-rebuild';
import { streamAnswer } from '../assistant-sse';
import { scopeFromSeller } from '../assistant-scope';
import {
  AssistantFeedbackDto,
  CreateConversationDto,
  SendAssistantMessageDto,
} from '../dto/assistant.dto';
import {
  AssistantAttachmentService,
  type UploadedFile as UploadedAttachment,
} from '../services/assistant-attachment.service';
import { AssistantFeedbackService } from '../services/assistant-feedback.service';
import { AssistantChatService } from '../services/assistant-chat.service';
import { AssistantConversationService } from '../services/assistant-conversation.service';
import { AssistantTicketService } from '../services/assistant-ticket.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * The assistant in the Client console.
 *
 * `@SellerSelfService`: a conversation is about the caller's own session,
 * so no team member needs a permission to HAVE one. What they can ASK
 * ABOUT is gated where it matters — each tool carries the permission key
 * of the route it mirrors and is not offered without it.
 */
@ApiTags('seller-assistant')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@SellerSelfService()
@Controller('seller/assistant')
export class SellerAssistantController {
  constructor(
    private readonly conversations: AssistantConversationService,
    private readonly chat: AssistantChatService,
    private readonly attachments: AssistantAttachmentService,
    private readonly ticketProposals: AssistantTicketService,
    private readonly feedback: AssistantFeedbackService,
  ) {}

  @Post('conversations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start a conversation with the assistant' })
  create(@CurrentSeller() seller: AuthenticatedSeller, @Body() body: CreateConversationDto) {
    return this.conversations.create(scopeFromSeller(seller), body.title ?? null);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'My conversations, newest first' })
  list(@CurrentSeller() seller: AuthenticatedSeller) {
    return this.conversations.list(scopeFromSeller(seller));
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'One of my conversations (404 for anyone else’s)' })
  get(@CurrentSeller() seller: AuthenticatedSeller, @Param('id', uuid()) id: string) {
    return this.conversations.getMine(scopeFromSeller(seller), id);
  }

  @Post('conversations/:id/messages')
  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  @ApiOperation({ summary: 'Ask a question; the answer streams back as server-sent events' })
  async send(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
    @Body() body: SendAssistantMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    const scope = scopeFromSeller(seller);
    await this.chat.requireOwned(scope, id); // a plain 404 before any stream
    const attachmentIds = body.attachmentIds ?? [];
    await this.attachments.requireUnsent(scope, id, attachmentIds); // so is a stranger's file
    await streamAnswer(res, (emit) =>
      this.chat.send(scope, id, body.text, emit, body.context ?? null, attachmentIds),
    );
  }

  /**
   * The ONE thing that turns a proposal into a ticket: a person pressing the
   * button. Owner-only (404 for anyone else's), permission re-checked here,
   * exactly once however many clicks.
   */
  @Post('ticket-proposals/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  @ApiOperation({
    summary: 'Raise the ticket the assistant proposed (the person pressed the button)',
  })
  confirmTicket(@CurrentSeller() seller: AuthenticatedSeller, @Param('id', uuid()) id: string) {
    return this.ticketProposals.confirm(scopeFromSeller(seller), id);
  }

  @Post('ticket-proposals/:id/dismiss')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  @ApiOperation({ summary: 'Decline a ticket the assistant proposed' })
  dismissTicket(@CurrentSeller() seller: AuthenticatedSeller, @Param('id', uuid()) id: string) {
    return this.ticketProposals.dismiss(scopeFromSeller(seller), id);
  }

  @Post('conversations/:id/attachments')
  @HttpCode(HttpStatus.CREATED)
  // Per person (the controller's ThrottleKey), tighter than a question: each
  // upload costs a decode and a re-encode.
  @Throttle({ default: { limit: 15, ttl: 60 * 1000 } })
  @UseInterceptors(
    // One file, in memory. The limit is one byte over the cap so a file of
    // exactly cap+1 reaches the service and is refused with a coded error.
    FileInterceptor('file', {
      limits: { fileSize: MAX_ATTACHMENT_BYTES + 1, files: 1, fields: 4, parts: 6 },
    }),
  )
  @ApiOperation({
    summary: 'Attach an image or a PDF to a conversation (rebuilt, never stored as sent)',
  })
  upload(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
    @UploadedFile() file: UploadedAttachment | undefined,
  ) {
    return this.attachments.upload(scopeFromSeller(seller), id, file);
  }

  @Get('conversations/:id/attachments/:attachmentId/download')
  @ApiOperation({
    summary:
      'A short-lived signed link that downloads one of my attachments (404 for anyone else’s)',
  })
  download(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
    @Param('attachmentId', uuid()) attachmentId: string,
  ) {
    return this.attachments.downloadUrl(scopeFromSeller(seller), id, attachmentId);
  }

  @Post('conversations/:id/feedback')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60 * 1000 } })
  @ApiOperation({
    summary: 'Thumbs up / down on one of my answers (owner only; never sent to the model)',
  })
  rate(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
    @Body() body: AssistantFeedbackDto,
  ) {
    return this.feedback.rate(
      scopeFromSeller(seller),
      id,
      body.messageId,
      body.rating,
      body.comment,
    );
  }
}
