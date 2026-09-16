import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { DecideAddressChangeDto } from '../dto/address-change.dto';
import { SellerAddressChangeDecisionService } from '../services/seller-address-change-decision.service';
import type { AddressChangeRequestView } from '../services/store-address-change.service';

/**
 * The seller's queue for address corrections their reseller stores asked
 * for (2026-09-16, owner).
 *
 * A SIBLING of `/seller/store-action-requests` rather than part of it:
 * the two hold different rows (a delivery action needs a shipment; a
 * correction happens before there is one) and folding them into one
 * endpoint would mean a response shape that is half one thing and half
 * another. The single queue PAGE calls both, which is where they belong
 * together — in front of a person, not in the wire format.
 *
 * Only corrections their own policy marked "ask me first" stop here. The
 * ones they set to go straight through never appear — they were written
 * onto the order the moment the store sent them.
 *
 * `stores.manage` because this is the same authority as the rest of
 * running a store: a decision about somebody else's business, made on
 * the seller's goods and printed on the seller's courier label.
 */
@ApiTags('seller-reseller-stores')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('stores.manage')
@Controller('seller/store-address-changes')
export class SellerAddressChangeController {
  constructor(private readonly svc: SellerAddressChangeDecisionService) {}

  @Get()
  @ApiOperation({
    summary:
      'Address corrections your stores are waiting on, oldest first — with the order’s CURRENT ' +
      'details, so the change can be compared against what the parcel carries today',
  })
  list(@CurrentSeller() seller: AuthenticatedSeller): Promise<readonly unknown[]> {
    return this.svc.listPending(seller.id);
  }

  @Post(':requestId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Say yes, and the correction is written onto the order — the same way it would have been if ' +
      'you had let this store correct addresses on its own',
  })
  approve(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('requestId', new ParseUUIDPipe({ version: '7' })) requestId: string,
    @Body() body: DecideAddressChangeDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<AddressChangeRequestView> {
    return this.svc.approve(seller, requestId, body.note ?? null, {
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: null,
    });
  }

  @Post(':requestId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Say no. The reason is shown to the store.' })
  reject(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('requestId', new ParseUUIDPipe({ version: '7' })) requestId: string,
    @Body() body: DecideAddressChangeDto,
  ): Promise<AddressChangeRequestView> {
    const note = body.note?.trim() ?? '';
    if (note === '') {
      // The store reads this. A refusal with nothing in it is a dead end
      // for whoever has to go back to the customer about an address they
      // know is wrong.
      throw new BadRequestException({
        code: 'ADDRESS_CHANGE_REASON_REQUIRED',
        message: 'Tell the store why — they have a customer waiting on this answer.',
      });
    }
    return this.svc.reject(seller, requestId, note);
  }
}
