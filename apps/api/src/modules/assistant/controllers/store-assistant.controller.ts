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
import { StoreSelfService } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { MAX_ATTACHMENT_BYTES } from '../assistant-attachment-rebuild';
import { streamAnswer } from '../assistant-sse';
import { scopeFromStoreUser } from '../assistant-scope';
import { CreateConversationDto, SendAssistantMessageDto } from '../dto/assistant.dto';
import {
  AssistantAttachmentService,
  type UploadedFile as UploadedAttachment,
} from '../services/assistant-attachment.service';
import { AssistantChatService } from '../services/assistant-chat.service';
import { AssistantConversationService } from '../services/assistant-conversation.service';
import { AssistantTicketService } from '../services/assistant-ticket.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * The assistant in the Member store and Associate consoles.
 *
 * `@StoreSelfService`: a conversation is about the caller's own session,
 * so no team member needs a permission to HAVE one. What they can ASK
 * ABOUT is gated where it matters — each tool carries the permission key
 * of the route it mirrors and is not offered without it.
 */
@ApiTags('store-assistant')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@StoreSelfService()
@Controller('store/assistant')
export class StoreAssistantController {
  constructor(
    private readonly conversations: AssistantConversationService,
    private readonly chat: AssistantChatService,
    private readonly attachments: AssistantAttachmentService,
    private readonly ticketProposals: AssistantTicketService,
  ) {}

  @Post('conversations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start a conversation with the assistant' })
  create(@CurrentStoreUser() user: AuthenticatedStoreUser, @Body() body: CreateConversationDto) {
    return this.conversations.create(scopeFromStoreUser(user), body.title ?? null);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'My conversations, newest first' })
  list(@CurrentStoreUser() user: AuthenticatedStoreUser) {
    return this.conversations.list(scopeFromStoreUser(user));
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'One of my conversations (404 for anyone else’s)' })
  get(@CurrentStoreUser() user: AuthenticatedStoreUser, @Param('id', uuid()) id: string) {
    return this.conversations.getMine(scopeFromStoreUser(user), id);
  }

  @Post('conversations/:id/messages')
  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  @ApiOperation({ summary: 'Ask a question; the answer streams back as server-sent events' })
  async send(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', uuid()) id: string,
    @Body() body: SendAssistantMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    const scope = scopeFromStoreUser(user);
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
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @ApiOperation({
    summary: 'Raise the ticket the assistant proposed (the person pressed the button)',
  })
  confirmTicket(@CurrentStoreUser() user: AuthenticatedStoreUser, @Param('id', uuid()) id: string) {
    return this.ticketProposals.confirm(scopeFromStoreUser(user), id);
  }

  @Post('ticket-proposals/:id/dismiss')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  @ApiOperation({ summary: 'Decline a ticket the assistant proposed' })
  dismissTicket(@CurrentStoreUser() user: AuthenticatedStoreUser, @Param('id', uuid()) id: string) {
    return this.ticketProposals.dismiss(scopeFromStoreUser(user), id);
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
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', uuid()) id: string,
    @UploadedFile() file: UploadedAttachment | undefined,
  ) {
    return this.attachments.upload(scopeFromStoreUser(user), id, file);
  }

  @Get('conversations/:id/attachments/:attachmentId/download')
  @ApiOperation({
    summary:
      'A short-lived signed link that downloads one of my attachments (404 for anyone else’s)',
  })
  download(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', uuid()) id: string,
    @Param('attachmentId', uuid()) attachmentId: string,
  ) {
    return this.attachments.downloadUrl(scopeFromStoreUser(user), id, attachmentId);
  }
}
