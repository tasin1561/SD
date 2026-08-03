import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { minutes } from '../../../common/throttler/throttler.module';
import { SubmitInviteLeadDto } from '../dto/invite-lead.dto';
import { InviteLeadService } from '../services/invite-lead.service';

/**
 * The one open, unauthenticated write on the marketing site.
 *
 * It replaces a `mailto:` link, which asked the browser to hand off to a
 * mail client and silently lost everyone whose device could not.
 *
 * Being open, it is built to be boring under abuse: it writes a row in a
 * table nothing else reads, it cannot create anything that can log in,
 * and it is rate-limited per IP. The worst a flood achieves is a list an
 * admin filters.
 *
 * The response is deliberately identical whether the address is new,
 * repeated, or caught by the honeypot. A public endpoint that answers
 * differently for a known address is an address-enumeration oracle, and
 * one that tells a bot it was caught teaches it to try harder.
 */
@ApiTags('public-marketing')
@Controller('public/invite-leads')
export class PublicInviteLeadController {
  constructor(private readonly leads: InviteLeadService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  // Per IP, not per email — the email is attacker-chosen and free.
  // Generous enough that a family sharing an office NAT is fine, tight
  // enough that a script is not.
  @ThrottleKey('ip')
  @Throttle({ default: { limit: 5, ttl: minutes(10) } })
  @ApiOperation({ summary: 'Ask for a beta invite. Open, rate-limited, honeypot-guarded.' })
  async submit(
    @Body() body: SubmitInviteLeadDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ received: true }> {
    // Honeypot: hidden from people, irresistible to scripts. Answer as
    // though it worked, and write nothing.
    if (body.website !== undefined && body.website.trim() !== '') {
      return { received: true };
    }

    await this.leads.submit({
      fullName: body.fullName,
      companyName: body.companyName,
      email: body.email,
      phone: body.phone,
      altPhone: body.altPhone,
      shippingDirection: body.shippingDirection,
      productTypes: body.productTypes,
      monthlyOrders: body.monthlyOrders,
      message: body.message,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    return { received: true };
  }
}
