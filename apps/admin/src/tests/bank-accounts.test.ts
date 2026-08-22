import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The accounts sellers are told to send money to.
 *
 * Found by the reverse half of `check-frontend-routes.py` on the day it
 * was written — four routes with no caller anywhere in either app. The
 * seller side reads them fine (`/seller/wallet/topups/bank-accounts`
 * populates the transfer form), so nothing looked broken; what was
 * missing was any way to CHANGE them. An account could only arrive by a
 * direct INSERT, and once sellers were paying into it there was no
 * interface to fix a wrong branch code or withdraw a closing account.
 *
 * That is the worst shape for this particular record: it is read by
 * people about to move real money, and it is exactly the thing you need
 * to correct under time pressure.
 */

const R = (p: string): string => readFileSync(join(__dirname, p), 'utf8');

const PANEL = R('../app/(authed)/transfer-accounts/_bank-accounts-panel.tsx');
const HOOKS = R('../lib/bank-account-hooks.ts');
const DTO = R('../../../api/src/modules/wallet-topup/dto/wallet-topup.dto.ts');
const CONTROLLER = R(
  '../../../api/src/modules/wallet-topup/controllers/admin-platform-bank-account.controller.ts',
);

describe('the body matches UpsertPlatformBankAccountDto', () => {
  const dtoFields = (() => {
    const from = DTO.indexOf('class UpsertPlatformBankAccountDto');
    const next = DTO.indexOf('class ', from + 6);
    const block = DTO.slice(from, next === -1 ? undefined : next);
    return new Set(
      Array.from(block.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)[?!]:/gm), (m) => m[1] as string),
    );
  })();

  it('the DTO declares the nine fields the form sends', () => {
    for (const f of [
      'label',
      'bankName',
      'accountName',
      'accountNumber',
      'branchCode',
      'currency',
      'instructions',
      'isActive',
      'displayOrder',
    ]) {
      expect(dtoFields).toContain(f);
    }
  });

  it('the client body type names those and nothing else', () => {
    const from = HOOKS.indexOf('export interface UpsertBankAccountBody');
    const block = HOOKS.slice(from, HOOKS.indexOf('}', from));
    const sent = Array.from(
      block.matchAll(/readonly ([a-zA-Z][a-zA-Z0-9]*)\??:/g),
      (m) => m[1] as string,
    );
    expect(sent.length).toBeGreaterThan(0);
    // forbidNonWhitelisted: a key the DTO does not declare 400s the call.
    for (const f of sent) expect(dtoFields).toContain(f);
  });

  it('an empty optional is OMITTED, never sent as an empty string', () => {
    // `''` passes @IsOptional and is stored — so a blank branch code
    // would render on the seller's transfer form as though it were real.
    expect(PANEL).toContain("form.branchCode.trim() !== ''");
    expect(PANEL).toContain("form.instructions.trim() !== ''");
  });
});

describe('it gates on what the server enforces', () => {
  it('reads need money.view, writes need money.bank_accounts.manage', () => {
    expect(CONTROLLER).toContain("@RequirePermissions('money.view')");
    expect(CONTROLLER).toContain("@RequirePermissions('money.bank_accounts.manage')");
  });

  it('the panel asks for the WRITE permission, not the read one', () => {
    // Gating the buttons on money.view would show Edit to someone the
    // server refuses — cosmetic RBAC still has to be honest (FE-2).
    expect(PANEL).toContain("usePermission('money.bank_accounts.manage')");
  });

  it('the list still renders without the write permission', () => {
    // Knowing which account is live is part of reading the top-up queue;
    // only the actions are hidden.
    expect(PANEL).toContain('{mayManage && <Th align="right">Actions</Th>}');
    expect(PANEL).not.toMatch(/if \(!mayManage\) return null;/);
  });

  it('surfaces the server verdict verbatim on every write', () => {
    expect(PANEL).toContain('serverVerdict(err)');
  });
});

describe('retiring says what it does and does not do', () => {
  it('the server soft-deletes so past top-ups keep resolving', () => {
    expect(CONTROLLER).toContain('deletedAt');
  });

  it('the wording promises exactly that', () => {
    // "Delete" would read as though the history went with it.
    expect(PANEL).toContain('Retire');
    expect(PANEL).toContain('Past top-ups keep it');
    expect(PANEL).not.toMatch(/>\s*Delete\s*</);
  });
});

describe('the empty state states the consequence', () => {
  it('says a seller cannot top up at all until one exists', () => {
    // "No accounts" is a fact; this is what the fact costs.
    expect(PANEL).toContain('cannot top up at all');
  });
});
