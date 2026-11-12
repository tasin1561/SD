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
import { StaffSelfService } from '../../../common/auth/require-permissions.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { streamAnswer } from '../assistant-sse';
import { scopeFromStaff } from '../assistant-scope';
import { CreateConversationDto, SendAssistantMessageDto } from '../dto/assistant.dto';
import { AssistantChatService } from '../services/assistant-chat.service';
import { AssistantConversationService } from '../services/assistant-conversation.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * The assistant in the admin console.
 *
 * `@StaffSelfService`: a conversation is about the caller's own session,
 * so no staff member needs a permission to HAVE one. What they can ASK
 * ABOUT is gated where it matters — each tool carries the permission key
 * of the route it mirrors and is not offered without it.
 */
@ApiTags('admin-assistant')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@StaffSelfService()
@Controller('admin/assistant')
export class AdminAssistantController {
  constructor(
    private readonly conversations: AssistantConversationService,
    private readonly chat: AssistantChatService,
  ) {}

  @Post('conversations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start a conversation with the assistant' })
  create(@CurrentStaff() staff: AuthenticatedStaff, @Body() body: CreateConversationDto) {
    return this.conversations.create(scopeFromStaff(staff), body.title ?? null);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'My conversations, newest first' })
  list(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.conversations.list(scopeFromStaff(staff));
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'One of my conversations (404 for anyone else’s)' })
  get(@CurrentStaff() staff: AuthenticatedStaff, @Param('id', uuid()) id: string) {
    return this.conversations.getMine(scopeFromStaff(staff), id);
  }

  @Post('conversations/:id/messages')
  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  @ApiOperation({ summary: 'Ask a question; the answer streams back as server-sent events' })
  async send(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', uuid()) id: string,
    @Body() body: SendAssistantMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    const scope = scopeFromStaff(staff);
    await this.chat.requireOwned(scope, id); // a plain 404 before any stream
    await streamAnswer(res, (emit) => this.chat.send(scope, id, body.text, emit));
  }
}
