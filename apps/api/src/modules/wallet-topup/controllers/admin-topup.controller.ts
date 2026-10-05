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

import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { WalletTopupService, type TopupRequestView } from '../services/wallet-topup.service';
import { ListTopupsQueryDto, RejectTopupDto, ReviewTopupDto } from '../dto/wallet-topup.dto';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

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
@RequirePermissions('money.view')
@Controller('admin/wallet/topups')
export class AdminTopupController {
  constructor(private readonly svc: WalletTopupService) {}

  @Get()
  @ApiOperation({ summary: 'The queue — PENDING first, oldest first within a status' })
  list(@Query() query: ListTopupsQueryDto): Promise<TopupRequestView[]> {
    return this.svc.listForAdmin(query.status);
  }

  /**
   * The proof is a bank-transfer screenshot — the seller's account name
   * and number. The same facts in structured form are behind
   * `sellers.bank_account.reveal`, which is dangerous and audited, so
   * this cannot sit on the class's plain `money.view`: that key reads
   * "View the money surfaces … read only" and is held across 22
   * handlers in 7 modules.
   *
   * `money.topups.review` rather than a NEW key, deliberately. The
   * people who check a claim against the statement are exactly the
   * people who accept or reject it — the sibling handlers below — so
   * this adds nothing to their day. A new key would reach no role that
   * already exists (the seeded ones were written by migration with
   * explicit lists), so the queue's proof button would 403 for the whole
   * estate until somebody granted it. Reusing
   * `sellers.bank_account.reveal` was the other candidate and loses the
   * other way round: a top-up reviewer need not hold it, so the people
   * who must see the proof would be the ones locked out.
   *
   * Still a GET. The audit lives in the service and fires before the URL
   * is minted, so the security property does not need the method to
   * change — and changing it would break the admin caller for nothing.
   */
  @Get(':topupId/proof-url')
  @RequirePermissions('money.topups.review')
  @ApiOperation({
    summary:
      'A short-lived link to the uploaded proof. It is bank detail, so the read is audited HIGH.',
  })
  async proof(
    @Param('topupId', new ParseUUIDPipe({ version: '7' })) topupId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ url: string }> {
    return { url: await this.svc.proofUrl(topupId, { kind: 'STAFF', staffId: staff.id, ctx }) };
  }

  @Post(':topupId/accept')
  @RequirePermissions('money.topups.review')
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
    return this.svc.accept(topupId, staff.id, body.note ?? null, ctx);
  }

  @Post(':topupId/reject')
  @RequirePermissions('money.topups.review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Not found, or does not match. The reason is shown to the seller.' })
  reject(
    @Param('topupId', new ParseUUIDPipe({ version: '7' })) topupId: string,
    @Body() body: RejectTopupDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<TopupRequestView> {
    return this.svc.reject(topupId, staff.id, body.reason, ctx);
  }
}
