import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { CreateSellerAddressDto } from './dto/create-address.dto';
import { UpdateSellerAddressDto } from './dto/update-address.dto';
import { SellerAddressService, type SellerAddressView } from './services/seller-address.service';

@ApiTags('seller-addresses')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@Controller('seller/addresses')
export class SellerAddressController {
  constructor(private readonly svc: SellerAddressService) {}

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List the seller-owned addresses (BD_ORIGIN/BD_OFFICE/IN_RETURN)' })
  list(@CurrentSeller() seller: AuthenticatedSeller): Promise<SellerAddressView[]> {
    return this.svc.list(seller.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new address; first-of-type becomes default automatically' })
  create(
    @Body() body: CreateSellerAddressDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<SellerAddressView> {
    return this.svc.create(seller.id, body, ctx);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Partial update of an address' })
  update(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: UpdateSellerAddressDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<SellerAddressView> {
    return this.svc.update(seller.id, id, body, ctx);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete an address (clears isDefault)' })
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.svc.softDelete(seller.id, id, ctx);
  }

  @Post(':id/set-default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark this address as default for its type; unsets others' })
  setDefault(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<SellerAddressView> {
    return this.svc.setDefault(seller.id, id, ctx);
  }
}
