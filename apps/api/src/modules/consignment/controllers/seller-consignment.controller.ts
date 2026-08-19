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
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { SellerAuthAllowSuspended } from '../../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { ConsignmentEventService } from '../../consignment-core/services/consignment-event.service';
import {
  CancelConsignmentDto,
  DeclareConsignmentDto,
  ListConsignmentsQueryDto,
} from '../dto/consignment.dto';
import {
  ConsignmentCancelService,
  type CancelResult,
} from '../services/consignment-cancel.service';
import { ConsignmentService, type ConsignmentView } from '../services/consignment.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * The seller's view of their stock in motion.
 *
 * The timeline is the point of this controller: a seller who has sent
 * goods to another country wants to know where they are, and previously
 * got one status word in a list plus two emails.
 */
@ApiTags('seller-consignments')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('inbound.view')
@Controller('seller/consignments')
export class SellerConsignmentController {
  constructor(
    private readonly svc: ConsignmentService,
    private readonly cancels: ConsignmentCancelService,
    private readonly events: ConsignmentEventService,
  ) {}

  @Post()
  @RequireSellerPermissions('inbound.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Announce a consignment and say where you are sending it',
    description:
      'DIRECT_IN goes straight to the Indian warehouse. VIA_BD goes to our Bangladesh ' +
      'warehouse first and we forward it — that leg is the one we bill freight for. ' +
      'Rejects BD_WAREHOUSE_NOT_CONFIGURED when VIA_BD has nowhere to land.',
  })
  declare(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: DeclareConsignmentDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ConsignmentView> {
    return this.svc.declare(seller.id, body, ctx);
  }

  @Get()
  @SellerAuthAllowSuspended()
  @ApiOperation({ summary: 'List your consignments' })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() query: ListConsignmentsQueryDto,
  ): Promise<{ items: ConsignmentView[]; total: number; page: number; pageSize: number }> {
    return this.svc.listForSeller(seller.id, query);
  }

  @Get(':id')
  @SellerAuthAllowSuspended()
  @ApiOperation({ summary: 'One consignment, with every leg and count' })
  get(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
  ): Promise<ConsignmentView> {
    return this.svc.getForSeller(seller.id, id);
  }

  @Get(':id/events')
  @SellerAuthAllowSuspended()
  @ApiOperation({
    summary: 'The consignment timeline — what happened to your stock, in order',
  })
  async timeline(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
  ): Promise<
    Array<{ id: string; type: string; description: string | null; createdAt: Date; data: unknown }>
  > {
    // Ownership first: the event list carries counts and warehouse names,
    // so it must not be readable for somebody else's consignment.
    await this.svc.getForSeller(seller.id, id);
    return this.events.listForConsignment(id, { sellerVisibleOnly: true });
  }

  @Post(':id/cancel')
  @RequireSellerPermissions('inbound.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Abandon a consignment — the goods come back to you',
    description:
      'Only before it leaves Bangladesh. Rejects CONSIGNMENT_ALREADY_DISPATCHED once it is ' +
      'in the air, and CONSIGNMENT_ALREADY_ARRIVED once it has landed.',
  })
  async cancel(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
    @Body() body: CancelConsignmentDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CancelResult> {
    await this.svc.getForSeller(seller.id, id);
    return this.cancels.cancel({ sellerId: seller.id }, id, body.reason, ctx);
  }
}
