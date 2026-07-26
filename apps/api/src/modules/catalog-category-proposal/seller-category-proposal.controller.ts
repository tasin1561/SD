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
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { CreateCategoryProposalDto } from './dto/create-proposal.dto';
import { ListCategoryProposalsQueryDto } from './dto/list-proposals.dto';
import {
  SellerCategoryProposalService,
  type CategoryProposalView,
} from './services/seller-category-proposal.service';
import { SellerUserRole } from '@skydrop/db';
import { SellerRoles } from '../../common/decorators/seller-roles.decorator';

@ApiTags('seller-category-proposals')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@SellerRoles(SellerUserRole.OWNER, SellerUserRole.ADMIN, SellerUserRole.INVENTORY)
@Controller('seller/category-proposals')
export class SellerCategoryProposalController {
  constructor(private readonly svc: SellerCategoryProposalService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Propose a new category (APPROVED sellers only)' })
  propose(
    @Body() body: CreateCategoryProposalDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CategoryProposalView> {
    return this.svc.propose(seller.id, body, ctx);
  }

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "List the seller's own category proposals" })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() query: ListCategoryProposalsQueryDto,
  ): Promise<{ items: CategoryProposalView[]; total: number; page: number; pageSize: number }> {
    return this.svc.list(seller.id, query);
  }

  @Get(':id')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get one of the seller’s own proposals' })
  getById(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<CategoryProposalView> {
    return this.svc.getById(seller.id, id);
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw a PENDING proposal (APPROVED sellers only)' })
  withdraw(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CategoryProposalView> {
    return this.svc.withdraw(seller.id, id, ctx);
  }
}
