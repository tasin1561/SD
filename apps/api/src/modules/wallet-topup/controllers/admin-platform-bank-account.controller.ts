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
import { ActorType, AuditSeverity, BankEntryType, BankOwnerKind } from '@skydrop/db';

import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { UpsertPlatformBankAccountDto } from '../dto/wallet-topup.dto';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { BankLedgerService } from '../../treasury/services/bank-ledger.service';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { AuditLogService } from '../../auth-common/services/audit-log.service';

/**
 * What an audit row about one of these accounts is filed under. One
 * constant, because the history endpoint reads back exactly what the
 * three writers put in — a typo in either half would produce an empty
 * history over a busy account, which looks identical to nothing having
 * changed.
 */
const BANK_ACCOUNT_ENTITY = 'platform_bank_account';

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
    private readonly audit: AuditLogService,
  ) {}

  /*
    ── WHY EVERY CHANGE HERE IS AUDITED ─────────────────────────────────
    These are the account details a SELLER reads off their screen and
    types into their bank. Change the account number and every payment
    from that moment goes somewhere else — and the only trace would have
    been a row that quietly holds different digits than it did
    yesterday, with nobody able to say who changed them or when.

    None of it was recorded until 2026-09-07. Create, edit and retire now
    each write an audit row carrying the BEFORE and AFTER, which is what
    makes "when did this number change" answerable at all.
  */

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
    const created = await this.prisma.client.$transaction(async (tx) => {
      const account = await tx.platformBankAccount.create({
        data: {
          label: body.label,
          bankName: body.bankName,
          accountName: body.accountName,
          accountNumber: body.accountNumber,
          branchCode: body.branchCode ?? null,
          branchName: body.branchName ?? null,
          purpose: body.purpose ?? null,
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
            // The P&L reads the mark, never the entry's position: this is
            // the account's opening balance, and there is only one.
            isOpeningBalance: true,
          },
          tx,
        );
      }

      return account;
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      action: 'staff.platform_bank_account.created',
      entityType: BANK_ACCOUNT_ENTITY,
      entityId: created.id,
      // A new account sellers will be told to pay into. Not CRITICAL —
      // adding one is ordinary — but never LOW.
      severity: AuditSeverity.HIGH,
      metadata: {
        after: {
          label: body.label,
          bankName: body.bankName,
          accountName: body.accountName,
          accountNumber: body.accountNumber,
          currency: body.currency,
          isActive: body.isActive ?? true,
        },
        openingBalance: body.openingBalance ?? null,
      },
    });

    return created;
  }

  /** The history of who changed these accounts, and to what. */
  @Get('history')
  @ApiOperation({
    summary:
      'Every add, edit and retirement of our own bank accounts — who did it, when, and what changed.',
  })
  async history(): Promise<unknown[]> {
    const rows = await this.prisma.client.auditLog.findMany({
      where: { entityType: BANK_ACCOUNT_ENTITY },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: {
        id: true,
        action: true,
        entityId: true,
        createdAt: true,
        severity: true,
        metadata: true,
        staffUser: { select: { emailDisplay: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      accountId: r.entityId,
      at: r.createdAt.toISOString(),
      severity: r.severity,
      byName: r.staffUser?.emailDisplay ?? null,
      metadata: r.metadata,
    }));
  }

  @Patch(':id')
  @RequirePermissions('money.bank_accounts.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Edit an account (or flip isActive to stop offering it)' })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: UpsertPlatformBankAccountDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<unknown> {
    // Read BEFORE the write. "The account number is now X" is not the
    // useful fact; "it was Y and became X" is, and it cannot be
    // recovered afterwards.
    const before = await this.prisma.client.platformBankAccount.findUnique({
      where: { id },
      select: {
        label: true,
        bankName: true,
        accountName: true,
        accountNumber: true,
        branchCode: true,
        routingNumber: true,
        currency: true,
        isActive: true,
      },
    });

    const updated = await this.prisma.client.platformBankAccount.update({
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
        purpose: body.purpose ?? null,
        currency: body.currency,
        instructions: body.instructions ?? null,
        ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
        ...(body.displayOrder === undefined ? {} : { displayOrder: body.displayOrder }),
      },
    });

    const after = {
      label: body.label,
      bankName: body.bankName,
      accountName: body.accountName,
      accountNumber: body.accountNumber,
      branchCode: body.branchCode ?? null,
      routingNumber: body.routingNumber ?? null,
      currency: body.currency,
      isActive: body.isActive ?? before?.isActive ?? true,
    };
    // Which FIELDS moved, computed here rather than left to whoever
    // reads the log to diff two blobs by eye. The account number
    // changing is a different event from the label changing, and only
    // one of them redirects money.
    const changed = Object.keys(after).filter(
      (k) =>
        before !== null &&
        (before as Record<string, unknown>)[k] !== (after as Record<string, unknown>)[k],
    );

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      action: 'staff.platform_bank_account.updated',
      entityType: BANK_ACCOUNT_ENTITY,
      entityId: id,
      // CRITICAL when the destination itself moved: a seller reads
      // these digits and types them into their bank, so a changed
      // account number silently redirects every payment after it.
      severity: changed.includes('accountNumber') ? AuditSeverity.CRITICAL : AuditSeverity.HIGH,
      metadata: { before, after, changed },
    });

    return updated;
  }

  @Delete(':id')
  @RequirePermissions('money.bank_accounts.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Retire an account — soft delete, so past top-ups still resolve. Refused while it still holds money.',
  })
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<void> {
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

    const before = await this.prisma.client.platformBankAccount.findUnique({
      where: { id },
      select: { label: true, bankName: true, accountNumber: true, currency: true },
    });

    await this.prisma.client.platformBankAccount.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      action: 'staff.platform_bank_account.retired',
      entityType: BANK_ACCOUNT_ENTITY,
      entityId: id,
      // A soft delete, so nothing is lost — but the account stops being
      // offered to sellers, and knowing when that happened is how a
      // payment to it afterwards gets explained.
      severity: AuditSeverity.HIGH,
      metadata: { before },
    });
  }
}
