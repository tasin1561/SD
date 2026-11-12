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
import { StoreSelfService } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { streamAnswer } from '../assistant-sse';
import { scopeFromStoreUser } from '../assistant-scope';
import { CreateConversationDto, SendAssistantMessageDto } from '../dto/assistant.dto';
import { AssistantChatService } from '../services/assistant-chat.service';
import { AssistantConversationService } from '../services/assistant-conversation.service';

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
    await streamAnswer(res, (emit) => this.chat.send(scope, id, body.text, emit));
  }
}
