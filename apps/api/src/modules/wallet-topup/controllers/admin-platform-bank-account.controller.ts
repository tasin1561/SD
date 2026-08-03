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

import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { UpsertPlatformBankAccountDto } from '../dto/wallet-topup.dto';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

/**
 * The accounts we tell sellers to send money to.
 *
 * Retiring one is a soft delete, never a hard one: a past top-up names
 * the account it went to, and that record has to keep resolving long
 * after we stop using the account.
 */
@ApiTags('admin-platform-bank-accounts')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('money.view')
@Controller('admin/platform-bank-accounts')
export class AdminPlatformBankAccountController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Every account, including retired ones' })
  async list(): Promise<unknown[]> {
    return this.prisma.client.platformBankAccount.findMany({
      where: { deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { displayOrder: 'asc' }],
    });
  }

  @Post()
  @RequirePermissions('money.bank_accounts.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add an account sellers can transfer to' })
  async create(@Body() body: UpsertPlatformBankAccountDto): Promise<unknown> {
    return this.prisma.client.platformBankAccount.create({
      data: {
        label: body.label,
        bankName: body.bankName,
        accountName: body.accountName,
        accountNumber: body.accountNumber,
        branchCode: body.branchCode ?? null,
        currency: body.currency,
        instructions: body.instructions ?? null,
        isActive: body.isActive ?? true,
        displayOrder: body.displayOrder ?? 100,
      },
    });
  }

  @Patch(':id')
  @RequirePermissions('money.bank_accounts.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Edit an account (or flip isActive to stop offering it)' })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: UpsertPlatformBankAccountDto,
  ): Promise<unknown> {
    return this.prisma.client.platformBankAccount.update({
      where: { id },
      data: {
        label: body.label,
        bankName: body.bankName,
        accountName: body.accountName,
        accountNumber: body.accountNumber,
        branchCode: body.branchCode ?? null,
        currency: body.currency,
        instructions: body.instructions ?? null,
        ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
        ...(body.displayOrder === undefined ? {} : { displayOrder: body.displayOrder }),
      },
    });
  }

  @Delete(':id')
  @RequirePermissions('money.bank_accounts.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retire an account — soft delete, so past top-ups still resolve' })
  async remove(@Param('id', new ParseUUIDPipe({ version: '7' })) id: string): Promise<void> {
    await this.prisma.client.platformBankAccount.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }
}
