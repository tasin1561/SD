import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { RecipientAddressQueryDto } from '../dto/customer.dto';
import {
  RecipientAddressCacheService,
  type CachedAddressView,
} from '../services/recipient-address-cache.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

@ApiTags('seller-recipient-addresses')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@Controller('seller/recipient-addresses')
export class SellerRecipientAddressController {
  constructor(private readonly svc: RecipientAddressCacheService) {}

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recipient-address autocomplete (most-used first)' })
  autocomplete(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() query: RecipientAddressQueryDto,
  ): Promise<CachedAddressView[]> {
    return this.svc.autocomplete(seller.id, query);
  }

  @Get(':id')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get one cached recipient address' })
  get(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
  ): Promise<CachedAddressView> {
    return this.svc.getById(seller.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a cached recipient address (hard delete)' })
  async remove(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
  ): Promise<void> {
    await this.svc.remove(seller.id, id);
  }
}
