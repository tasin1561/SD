import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, minutes } from '@nestjs/throttler';
import type { Response } from 'express';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { streamAnswer } from '../assistant-sse';
import { PublicParcelMessageDto } from '../dto/public-parcel-assistant.dto';
import { AssistantPublicService } from '../services/assistant-public.service';
import { PublicParcelAwbThrottleGuard } from './public-parcel-awb-throttle.guard';

/**
 * The public tracking page's "Ask about this parcel" helper. NO auth: like
 * the page, the AWB is the access token, and the helper may say no more than
 * the page's own customer-safe projection (TRK-8) shows.
 *
 * Defences, outermost first: the per-IP throttle below, the per-AWB throttle
 * (guard), a 300-character question, six questions per chat, the public
 * switch (OFF by default) and the public monthly cap, then a model whose
 * only tool reads the one projection. The 404 for an unknown or malformed
 * AWB is the tracking page's own body.
 *
 * Per-IP: behind the Next route handler the API sees the tracking app's
 * address, so this number is also the ceiling on the whole helper; the
 * handler adds its own per-visitor limit in front.
 */
@ApiTags('public-parcel-assistant')
@ThrottleKey('ip')
@Controller('public/parcel-assistant')
export class PublicParcelAssistantController {
  constructor(private readonly publicAssistant: AssistantPublicService) {}

  @Get('status')
  @Throttle({ default: { limit: 120, ttl: minutes(1) } })
  @ApiOperation({ summary: 'Should the tracking page show the helper? (a boolean, nothing else)' })
  async status(): Promise<{ available: boolean }> {
    return { available: await this.publicAssistant.available() };
  }

  @Post(':awb/messages')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PublicParcelAwbThrottleGuard)
  @Throttle({ default: { limit: 30, ttl: minutes(1) } })
  @ApiOperation({
    summary:
      'Ask one question about the parcel on the tracking page; the answer streams back as server-sent events. Unknown AWB: the same 404 as the page.',
  })
  async send(
    @Param('awb') awb: string,
    @Body() body: PublicParcelMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    const parcel = await this.publicAssistant.requireParcel(awb); // the page's own 404
    if (body.conversationId !== undefined) {
      await this.publicAssistant.requireConversation(parcel, body.visitorKey, body.conversationId);
    }
    await streamAnswer(res, (emit) =>
      this.publicAssistant.send(parcel, body.visitorKey, body.conversationId, body.text, emit),
    );
  }
}
