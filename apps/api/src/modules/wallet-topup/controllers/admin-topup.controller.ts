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
import { StaffRole } from '@skydrop/db';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { requireStaffRoles } from '../../../common/auth/require-staff-roles';
import { WalletTopupService, type TopupRequestView } from '../services/wallet-topup.service';
import { ListTopupsQueryDto, RejectTopupDto, ReviewTopupDto } from '../dto/wallet-topup.dto';

/**
 * The review queue: someone checks the bank statement and decides.
 *
 * FINANCE or SUPER_ADMIN — accepting mints money in a seller's
 * wallet, so it sits with the same people who record remittances.
 */
@ApiTags('admin-wallet-topup')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/wallet/topups')
export class AdminTopupController {
  constructor(private readonly svc: WalletTopupService) {}

  @Get()
  @ApiOperation({ summary: 'The queue — PENDING first, oldest first within a status' })
  list(
    @Query() query: ListTopupsQueryDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<TopupRequestView[]> {
    requireStaffRoles(staff, [StaffRole.FINANCE, StaffRole.SUPER_ADMIN]);
    return this.svc.listForAdmin(query.status);
  }

  @Get(':topupId/proof-url')
  @ApiOperation({ summary: 'A short-lived link to the uploaded proof' })
  async proof(
    @Param('topupId', new ParseUUIDPipe({ version: '7' })) topupId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{ url: string }> {
    requireStaffRoles(staff, [StaffRole.FINANCE, StaffRole.SUPER_ADMIN]);
    return { url: await this.svc.proofUrl(topupId, null) };
  }

  @Post(':topupId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The money is on our statement — credit the wallet. Once only, guarded on PENDING.',
  })
  accept(
    @Param('topupId', new ParseUUIDPipe({ version: '7' })) topupId: string,
    @Body() body: ReviewTopupDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<TopupRequestView> {
    requireStaffRoles(staff, [StaffRole.FINANCE, StaffRole.SUPER_ADMIN]);
    return this.svc.accept(topupId, staff.id, body.note ?? null, ctx);
  }

  @Post(':topupId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Not found, or does not match. The reason is shown to the seller.' })
  reject(
    @Param('topupId', new ParseUUIDPipe({ version: '7' })) topupId: string,
    @Body() body: RejectTopupDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<TopupRequestView> {
    requireStaffRoles(staff, [StaffRole.FINANCE, StaffRole.SUPER_ADMIN]);
    return this.svc.reject(topupId, staff.id, body.reason, ctx);
  }
}
