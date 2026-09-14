import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import type { StorePercents } from '../terms/reseller-fee-types';
import {
  PreviewTermsQueryDto,
  PublishTermsDto,
  type TermsSharesDto,
} from '../dto/reseller-store-terms.dto';
import {
  ResellerStoreTermsService,
  type StoreTermsView,
  type TermsPreview,
} from '../services/reseller-store-terms.service';

function percentsFrom(dto: TermsSharesDto): StorePercents<string> {
  return {
    deliveryFeeStorePercent: dto.deliveryFeeStorePercent,
    returnFeeStorePercent: dto.returnFeeStorePercent,
    customerReturnFeeStorePercent: dto.customerReturnFeeStorePercent,
    codFeeStorePercent: dto.codFeeStorePercent,
    codTaxStorePercent: dto.codTaxStorePercent,
    instantPayFeeStorePercent: dto.instantPayFeeStorePercent,
  };
}

/**
 * A seller's reseller store TERMS (RS-4): read them, work a draft through
 * the real arithmetic, publish a new version.
 *
 * Reading needs `stores.manage` OR `stores.pricing` — the people who run
 * the store's page see what it is bound by. PUBLISHING needs
 * `stores.pricing` alone: it changes what every later order of that store
 * costs each side. Every query carries the seller id from the TOKEN.
 */
@ApiTags('seller-reseller-store-terms')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('stores.manage', 'stores.pricing')
@Controller('seller/reseller-stores/:storeId/terms')
export class SellerResellerStoreTermsController {
  constructor(private readonly terms: ResellerStoreTermsService) {}

  @Get()
  @ApiOperation({
    summary: 'The store’s terms: the version in force, its acceptance, every version',
  })
  view(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
  ): Promise<StoreTermsView> {
    return this.terms.viewForSeller(seller.id, storeId);
  }

  @Get('preview')
  @ApiOperation({ summary: 'A draft worked through the real split — the Terms tab’s live example' })
  preview(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Query() query: PreviewTermsQueryDto,
  ): Promise<TermsPreview> {
    return this.terms.preview(seller.id, storeId, {
      percents: percentsFrom(query),
      storeCredit:
        query.storeCreditTrigger === undefined
          ? undefined
          : { trigger: query.storeCreditTrigger, days: query.storeCreditDays ?? 0 },
      sellerCredit:
        query.sellerCreditTrigger === undefined
          ? undefined
          : { trigger: query.sellerCreditTrigger, days: query.sellerCreditDays ?? 0 },
    });
  }

  @Post()
  @RequireSellerPermissions('stores.pricing')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Publish a new version — the store must accept it before its next order (MEDIUM audit)',
  })
  publish(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Body() body: PublishTermsDto,
  ): Promise<StoreTermsView> {
    return this.terms.publish(
      seller.id,
      storeId,
      {
        percents: percentsFrom(body),
        storeCredit: { trigger: body.storeCreditTrigger, days: body.storeCreditDays },
        sellerCredit: { trigger: body.sellerCreditTrigger, days: body.sellerCreditDays },
        note: body.note,
        basedOnVersion: body.basedOnVersion,
      },
      { sellerUserId: seller.userId, name: seller.fullName },
    );
  }
}
