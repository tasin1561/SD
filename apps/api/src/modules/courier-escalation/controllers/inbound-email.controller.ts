import { Body, Controller, HttpCode, HttpStatus, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CourierMessageChannel } from '@skydrop/db';
import { Public } from '../../../common/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { CourierEscalationIngestService } from '../services/courier-escalation-ingest.service';
import { parseCourierEmail } from '../services/courier-email-parser';
import { InboundEmailGuard } from '../guards/inbound-email.guard';
import { InboundEmailDto } from '../dto/inbound-email.dto';

/**
 * Where courier email enters the system.
 *
 * ── THE SHAPE, AND WHY ───────────────────────────────────────────────
 * Delhivery CCs a dedicated mailbox on ticket activity. Cloudflare Email
 * Routing catches that mailbox and hands it to a Worker
 * (`infra/cloudflare/courier-inbound-email-worker.js`), which signs the
 * payload and POSTs here. Cloudflare is used because it is already the
 * DNS authority for the domain, so no new vendor and no mailbox to poll;
 * the Worker exists because Email Routing can only forward or run a
 * Worker, and forwarding to a human is the thing we are replacing.
 *
 * Authentication is HMAC over the RAW BYTES (TRK-1 discipline), applied
 * by `InboundEmailGuard` so it runs BEFORE the ValidationPipe — an
 * unauthenticated caller gets 401, never a 400 describing our schema.
 * The endpoint fails closed when the secret is unset.
 *
 * Practical consequence worth knowing during provisioning: once the
 * secret IS set, a 400 means the Worker's payload disagrees with the DTO
 * and a 401 means the secrets disagree. Two different layers, two
 * different fixes.
 *
 * ── ACK FAST, PROCESS INLINE (FOR NOW) ───────────────────────────────
 * Unlike the tracking webhook this does NOT queue: courier email is a
 * handful of messages a day, ingest is two writes, and the Worker is not
 * a courier with a 500ms SLA. If volume ever makes that wrong, the seam
 * is one service call and the answer is a BullMQ job.
 *
 * A message for a ticket we do not know is answered 200 and logged, NOT
 * rejected: retrying it would not help — we would still not know the
 * ticket — and a 4xx would make Cloudflare retry a message that is
 * simply early.
 */
@ApiTags('public-courier-email')
@Controller('public/courier/inbound-email')
export class InboundEmailController {
  private readonly logger = new Logger(InboundEmailController.name);

  constructor(private readonly ingest: CourierEscalationIngestService) {}

  @Public()
  @UseGuards(InboundEmailGuard)
  @Post()
  @HttpCode(HttpStatus.OK)
  // Generous but finite: a Worker loop must not be able to spend the
  // API's capacity, and real volume here is a few messages a day.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Inbound courier email from the Cloudflare Email Routing Worker. HMAC-authenticated.',
  })
  async receive(@Body() body: InboundEmailDto): Promise<{ ok: true; result: string }> {
    // Reaching here means the guard already verified the signature.
    const parsed = parseCourierEmail({
      subject: body.subject,
      text: body.text ?? null,
      html: body.html ?? null,
    });

    if (parsed.externalTicketId === null) {
      // Visible rather than silent: an unparsed email means the parser's
      // guesses about Delhivery's format are wrong, and that is exactly
      // what we expect to have to correct against a real message.
      this.logger.warn(
        { subject: body.subject, from: body.from, messageId: body.messageId },
        'Courier email with no recognisable ticket id — parser needs correcting',
      );
      return { ok: true, result: 'NO_TICKET_ID' };
    }

    const result = await this.ingest.ingest({
      externalTicketId: parsed.externalTicketId,
      body: parsed.body,
      // Their timestamp when the Worker could supply one; otherwise
      // receipt time. Never silently now() when a real one exists —
      // same discipline as TRK-3.
      occurredAt: body.receivedAt === undefined ? new Date() : new Date(body.receivedAt),
      channel: CourierMessageChannel.EMAIL,
      sourceRef: body.messageId ?? null,
      awbNumber: parsed.awbNumber,
    });

    return { ok: true, result: result.kind };
  }
}
