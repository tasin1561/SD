import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
/*
  The window query shape is RS-8's own class, imported rather than
  re-declared: `from` and `to` are IST midnights sent by the frontend and
  what they MEAN is part of the contract, so a second class with its own
  Swagger text is how the two come to describe the same parameter
  differently. `reportWindow` is the authority on parsing them and on the
  refusals (INVALID_DATE / INVALID_RANGE).
*/
import { ReportWindowQueryDto } from '../../reseller-reports/dto/reseller-reports.dto';
import { reportWindow } from '../../reseller-reports/services/report-window';
import { SetAssociateOrdersPausedDto, SetAssociatePriceDto } from '../dto/associate.dto';
import {
  AssociateService,
  type AssociateAnalysisView,
  type AssociateCopyResult,
  type AssociateListView,
  type AssociatePriceRow,
  type AssociatePricesView,
} from '../services/associate.service';

/**
 * ASSOC-1 — the RESELLER managing its own sales people.
 *
 * Every handler is behind `associates.manage` and acts on the caller's
 * OWN store, which comes from the TOKEN and goes into the WHERE clause
 * (RS-2). An id in the path that is not a live member of that store is a
 * 404 that says nothing more — the refusal must not tell a caller
 * whether somebody exists at another store.
 *
 * This is the reseller's side. The associate's own side is the existing
 * `/store/*` routes their role reaches, narrowed by `orderScope`, plus
 * `GET /store/catalogue/sell`.
 */
@ApiTags('store-associates')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('associates.manage')
@Controller('store/associates')
export class StoreAssociateController {
  constructor(private readonly associates: AssociateService) {}

  @Get()
  @ApiOperation({
    summary: 'The store’s associates, how many products each is priced for, and who is paused',
  })
  list(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<AssociateListView> {
    return this.associates.list(user.storeId);
  }

  /**
   * DECLARED BEFORE `:storeUserId/...` on purpose.
   *
   * `ParseUUIDPipe` on that parameter means `analysis` cannot be
   * swallowed by it today — but the next person to relax that pipe for
   * some good reason of their own should not be able to turn this route
   * into a 400 silently, and route order is the one thing that keeps
   * that impossible rather than merely unlikely.
   */
  @Get('analysis')
  @ApiOperation({
    summary: 'Who is selling how much over a window, with the denominators behind every rate',
  })
  analysis(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Query() q: ReportWindowQueryDto,
  ): Promise<AssociateAnalysisView> {
    return this.associates.analysis(user.storeId, reportWindow(q.from, q.to));
  }

  @Get(':storeUserId/prices')
  @ApiOperation({
    summary: 'Every product the store may sell, with this person’s price and the seller’s range',
  })
  prices(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('storeUserId', new ParseUUIDPipe({ version: '7' })) storeUserId: string,
  ): Promise<AssociatePricesView> {
    return this.associates.pricesOf(user.storeId, storeUserId);
  }

  @Put(':storeUserId/prices/:variantId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set what this person sells one product at' })
  setPrice(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('storeUserId', new ParseUUIDPipe({ version: '7' })) storeUserId: string,
    @Param('variantId', new ParseUUIDPipe({ version: '7' })) variantId: string,
    @Body() body: SetAssociatePriceDto,
  ): Promise<AssociatePriceRow> {
    return this.associates.setPrice(user, storeUserId, variantId, body.retailPriceInr);
  }

  @Post(':storeUserId/prices/copy-from/:otherStoreUserId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Copy another associate’s whole price list onto this one; every overwrite is named in the reply',
  })
  copyPrices(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('storeUserId', new ParseUUIDPipe({ version: '7' })) storeUserId: string,
    @Param('otherStoreUserId', new ParseUUIDPipe({ version: '7' })) otherStoreUserId: string,
  ): Promise<AssociateCopyResult> {
    return this.associates.copyPrices(user, storeUserId, otherStoreUserId);
  }

  @Patch(':storeUserId/orders-paused')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Switch this person’s order creation on or off; what they placed carries on',
  })
  setOrdersPaused(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('storeUserId', new ParseUUIDPipe({ version: '7' })) storeUserId: string,
    @Body() body: SetAssociateOrdersPausedDto,
  ): Promise<{ readonly storeUserId: string; readonly ordersPausedAt: string | null }> {
    return this.associates.setOrdersPaused(user, storeUserId, body.paused);
  }
}
