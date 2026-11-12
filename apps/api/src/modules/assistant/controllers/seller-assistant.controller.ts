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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { SellerSelfService } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { streamAnswer } from '../assistant-sse';
import { scopeFromSeller } from '../assistant-scope';
import { CreateConversationDto, SendAssistantMessageDto } from '../dto/assistant.dto';
import { AssistantChatService } from '../services/assistant-chat.service';
import { AssistantConversationService } from '../services/assistant-conversation.service';

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
    await streamAnswer(res, (emit) =>
      this.chat.send(scope, id, body.text, emit, body.context ?? null),
    );
  }
}
