import {
  Body,
  ConflictException,
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
import { BankEntryType, BankOwnerKind } from '@skydrop/db';

import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { UpsertPlatformBankAccountDto } from '../dto/wallet-topup.dto';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { BankLedgerService } from '../../treasury/services/bank-ledger.service';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: BankLedgerService,
  ) {}

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
  async create(
    @Body() body: UpsertPlatformBankAccountDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<unknown> {
    // The account and what is in it, in ONE transaction.
    //
    // An account created without its balance starts at zero, and every
    // figure derived from it — the treasury total, client-money
    // coverage, the P&L's cash side — reads as zero with nothing saying
    // it is merely unentered. The alternative available before this was
    // to reconcile a brand-new account from 0 up to its real balance,
    // which files the money under "the book was wrong" when the book was
    // not wrong, it was empty.
    return this.prisma.client.$transaction(async (tx) => {
      const account = await tx.platformBankAccount.create({
        data: {
          label: body.label,
          bankName: body.bankName,
          accountName: body.accountName,
          accountNumber: body.accountNumber,
          branchCode: body.branchCode ?? null,
          branchName: body.branchName ?? null,
          district: body.district ?? null,
          routingNumber: body.routingNumber ?? null,
          currency: body.currency,
          instructions: body.instructions ?? null,
          isActive: body.isActive ?? true,
          displayOrder: body.displayOrder ?? 100,
        },
      });

      const opening = body.openingBalance?.trim();
      // Zero is a legitimate opening balance and needs no entry — the
      // ledger already says zero by having nothing in it, and post()
      // refuses a zero movement anyway.
      if (opening !== undefined && opening !== '' && Number(opening) !== 0) {
        await this.ledger.post(
          {
            accountId: account.id,
            type: BankEntryType.OPENING_BALANCE,
            signedAmount: opening,
            amountCurrency: body.currency,
            // OURS. An opening balance is what the business already had;
            // money held for a seller arrives through a top-up or a
            // settlement, each of which records why.
            owner: { kind: BankOwnerKind.CAPITAL },
            occurredAt: new Date(),
            staffId: staff.id,
            note: 'Opening balance, entered when the account was added',
          },
          tx,
        );
      }

      return account;
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
        branchName: body.branchName ?? null,
        district: body.district ?? null,
        routingNumber: body.routingNumber ?? null,
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
  @ApiOperation({
    summary:
      'Retire an account — soft delete, so past top-ups still resolve. Refused while it still holds money.',
  })
  async remove(@Param('id', new ParseUUIDPipe({ version: '7' })) id: string): Promise<void> {
    // An account with a balance cannot be retired, and this is not
    // tidiness. The treasury overview iterates NON-deleted accounts and
    // groups over ALL entries, so retiring an account with money in it
    // drops that money from every per-account figure on the page while
    // the client-money total still counts it — the two halves of the
    // same screen then disagree, and neither is obviously the wrong one.
    //
    // Empty it first (a transfer, or a reconciliation if the cash is
    // genuinely gone), then retire it.
    const balances = await this.prisma.client.bankEntry.groupBy({
      by: ['ownerKind'],
      where: { accountId: id },
      _sum: { signedAmount: true },
    });
    const outstanding = balances
      .map((b) => b._sum.signedAmount)
      .filter((v): v is NonNullable<typeof v> => v !== null)
      .filter((v) => !v.isZero());
    if (outstanding.length > 0) {
      throw new ConflictException({
        code: 'BANK_ACCOUNT_NOT_EMPTY',
        message:
          'This account still holds money. Move it out, or reconcile it to zero, before retiring it.',
        cause: { balances: outstanding.map((v) => v.toFixed(2)) },
      });
    }

    await this.prisma.client.platformBankAccount.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }
}
