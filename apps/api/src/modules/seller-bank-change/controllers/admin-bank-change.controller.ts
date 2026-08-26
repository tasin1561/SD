import {
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

import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { RejectBankChangeDto } from '../dto/reject-bank-change.dto';
import {
  BankChangeService,
  type BankChangeDecision,
  type BankChangeRequestView,
} from '../services/bank-change.service';

/**
 * Deciding whether a seller may move where their money is sent.
 *
 * Gated on its own permission rather than a general seller-admin one:
 * approving redirects a seller's withdrawals, which is a different act from
 * editing their profile, and the people who should hold it are the ones
 * already trusted with remittances.
 */
@ApiTags('admin-bank-changes')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('sellers.bank_change.approve')
@Controller('admin/bank-change-requests')
export class AdminBankChangeController {
  constructor(private readonly svc: BankChangeService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Bank changes waiting on a decision, oldest first, with the current values to compare.',
  })
  list(): Promise<{ items: BankChangeRequestView[] }> {
    return this.svc.listPending();
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Apply the proposed details to the seller's live account. From this moment their withdrawals go to the new destination.",
  })
  approve(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<BankChangeDecision> {
    return this.svc.approve(id, staff.id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refuse the change. Nothing moves; the seller reads the reason verbatim.',
  })
  reject(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: RejectBankChangeDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<BankChangeDecision> {
    return this.svc.reject(id, staff.id, body.reason);
  }
}
