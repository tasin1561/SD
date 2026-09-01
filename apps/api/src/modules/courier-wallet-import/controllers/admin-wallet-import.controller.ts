import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { ImportWalletLedgerDto } from '../dto/wallet-import.dto';
import { WalletImportService } from '../../wallet-ledger/services/wallet-import.service';

/**
 * Recording what the courier actually charged.
 *
 * Gated on `money.treasury.manage` rather than a courier permission:
 * what this writes is the cost side of the P&L, and it can REVISE a
 * figure somebody has already reported on. That is a treasury act that
 * happens to involve a courier, not the other way round.
 */
@ApiTags('admin-courier-wallet-import')
@ApiBearerAuth()
@Controller('admin/courier/wallet-import')
@UseGuards(StaffJwtGuard)
export class AdminWalletImportController {
  constructor(private readonly svc: WalletImportService) {}

  @Post('delhivery')
  @RequirePermissions('money.treasury.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Import a Delhivery wallet export and record what each parcel really cost. Takes the ' +
      'LATEST successful debit per AWB per leg — costs are re-cut weeks later, so this is ' +
      're-runnable and overwrites what it wrote before.',
  })
  async importDelhivery(
    @Body() body: ImportWalletLedgerDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<WalletImportService['importDelhiveryWallet']> {
    const file = Buffer.from(body.fileBase64, 'base64');
    return this.svc.importDelhiveryWallet(file, staff.id, {
      ...(body.dryRun === undefined ? {} : { dryRun: body.dryRun }),
      ...(body.force === undefined ? {} : { force: body.force }),
    });
  }
}
