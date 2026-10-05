import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ActorType } from '@skydrop/db';
import {
  WalletTopupService,
  type TopupProofReader,
} from '../../src/modules/wallet-topup/services/wallet-topup.service';
import {
  StoreTopupService,
  type StoreTopupProofReader,
} from '../../src/modules/reseller-store-wallet/services/store-topup.service';

/**
 * A top-up proof is BANK DETAIL, and reading somebody else's is recorded.
 *
 * ── WHAT WENT WRONG ──────────────────────────────────────────────────
 * `GET /admin/wallet/topups/:id/proof-url` and its store twin minted a
 * presigned link to a bank-transfer screenshot — the seller's account
 * name and number — under the class-level `money.view`, whose own
 * description reads "View the money surfaces … read only", and wrote no
 * audit row. The SAME facts in structured form are behind
 * `sellers.bank_account.reveal`: marked dangerous, and audited HIGH
 * before the plaintext is returned. One door recorded, the other not.
 *
 * ── WHY THE TESTS ARE THESE TWO SHAPES ───────────────────────────────
 * The behavioural half has to assert the ORDERING, not just that an
 * audit happened: a URL minted and then not recorded is a read that took
 * place with nothing to show it, so the row must land BEFORE the link
 * exists (CUR-1's rule for a credential decrypt, and what
 * `revealBankAccount` does).
 *
 * The structural half reads the controllers, because the defect was not
 * in any code path — it was in which decorator was absent. A
 * behavioural test cannot see a missing `@RequirePermissions`, and the
 * existing `.view`-guards-a-write specs cannot either: these are GETs,
 * and the rule they enforce is about writes.
 */

const SRC = join(__dirname, '../../src');

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...controllerFiles(full));
    else if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

/** Comments describe this rule in several files; only code counts. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('reading a top-up proof', () => {
  describe('the seller wallet', () => {
    function make(): {
      svc: WalletTopupService;
      order: string[];
      audit: jest.Mock;
      presign: jest.Mock;
    } {
      const order: string[] = [];
      const audit = jest.fn(async () => {
        order.push('audit');
        return 'a1';
      });
      const presign = jest.fn(async () => {
        order.push('presign');
        return 'https://spaces.example/signed';
      });
      const prisma = {
        client: {
          walletTopupRequest: {
            findFirst: jest.fn(async () => ({
              proofSpacesKey: 'topups/seller-1/abc.png',
              sellerId: 'seller-1',
            })),
          },
        },
      };
      const svc = new WalletTopupService(
        prisma as never,
        { presignGetUrl: presign } as never,
        { log: audit } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      return { svc, order, audit, presign };
    }

    it('a STAFF read is audited HIGH, BEFORE the link is minted', async () => {
      const { svc, order, audit } = make();
      const reader: TopupProofReader = { kind: 'STAFF', staffId: 'staff-1' };
      await expect(svc.proofUrl('11111111-1111-7111-8111-111111111111', reader)).resolves.toBe(
        'https://spaces.example/signed',
      );

      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: ActorType.STAFF,
          staffUserId: 'staff-1',
          sellerId: 'seller-1',
          action: 'staff.wallet_topup.proof_revealed',
          entityType: 'wallet_topup_request',
          // A uuid, never a code or a name — an `audit_logs.entity_id`
          // that is not one loses the WHOLE row (CLAUDE.md MUST #6).
          entityId: '11111111-1111-7111-8111-111111111111',
          severity: 'HIGH',
        }),
      );
      // The ordering IS the invariant.
      expect(order).toEqual(['audit', 'presign']);
    });

    it('a seller reading their OWN proof is scoped to them and is not audited', async () => {
      const { svc, order, audit } = make();
      await svc.proofUrl('11111111-1111-7111-8111-111111111111', {
        kind: 'SELLER',
        sellerId: 'seller-1',
      });
      expect(audit).not.toHaveBeenCalled();
      expect(order).toEqual(['presign']);
    });

    it('a seller read filters on their own id; a staff read does not', async () => {
      const { svc } = make();
      const findFirst = (
        svc as unknown as {
          prisma: { client: { walletTopupRequest: { findFirst: jest.Mock } } };
        }
      ).prisma.client.walletTopupRequest.findFirst;

      await svc.proofUrl('t1', { kind: 'SELLER', sellerId: 'seller-1' });
      expect(findFirst.mock.calls[0]?.[0]).toMatchObject({
        where: { id: 't1', sellerId: 'seller-1' },
      });

      await svc.proofUrl('t1', { kind: 'STAFF', staffId: 'staff-1' });
      // No seller filter — staff read any claim. The scoping argument
      // the old nullable id carried is preserved exactly.
      expect(findFirst.mock.calls[1]?.[0]?.where).not.toHaveProperty('sellerId');
    });
  });

  describe('the store wallet', () => {
    function make(): { svc: StoreTopupService; order: string[]; audit: jest.Mock } {
      const order: string[] = [];
      const audit = jest.fn(async () => {
        order.push('audit');
        return 'a1';
      });
      const presign = jest.fn(async () => {
        order.push('presign');
        return 'https://spaces.example/signed';
      });
      const prisma = {
        client: {
          storeTopupRequest: {
            findFirst: jest.fn(async () => ({
              proofSpacesKey: 'store-topups/store-1/abc.png',
              storeId: 'store-1',
              sellerId: 'seller-1',
            })),
          },
        },
      };
      const svc = new StoreTopupService(
        prisma as never,
        { presignGetUrl: presign } as never,
        { log: audit } as never,
        {} as never,
        {} as never,
        {} as never,
      );
      return { svc, order, audit };
    }

    it('a STAFF read is audited HIGH before the link, and names the SELLER', async () => {
      const { svc, order, audit } = make();
      const reader: StoreTopupProofReader = { kind: 'STAFF', staffId: 'staff-1' };
      await svc.proofUrl('22222222-2222-7222-8222-222222222222', reader);

      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: ActorType.STAFF,
          staffUserId: 'staff-1',
          // TRE-8c: the bank book knows only the seller, so "whose money
          // was this" is a question about them. The store is metadata.
          sellerId: 'seller-1',
          action: 'staff.store_topup.proof_revealed',
          entityType: 'store_topup_request',
          severity: 'HIGH',
          metadata: { storeId: 'store-1' },
        }),
      );
      expect(order).toEqual(['audit', 'presign']);
    });

    it('a store reading its own proof is not audited', async () => {
      const { svc, order, audit } = make();
      await svc.proofUrl('22222222-2222-7222-8222-222222222222', {
        kind: 'STORE',
        storeId: 'store-1',
      });
      expect(audit).not.toHaveBeenCalled();
      expect(order).toEqual(['presign']);
    });
  });

  describe('the permission on the door', () => {
    /**
     * Both admin proof handlers inherited `money.view` from their class.
     * These read the handler's OWN decorator, because inheriting the
     * class's is exactly how the defect arose: nobody wrote the wrong
     * key, somebody wrote no key.
     */
    const cases = [
      'modules/wallet-topup/controllers/admin-topup.controller.ts',
      'modules/reseller-store-wallet/controllers/admin-store-wallet.controller.ts',
    ];

    it.each(cases)('%s declares its own permission on the proof handler', (rel) => {
      const src = withoutComments(readFileSync(join(SRC, rel), 'utf8'));
      // The decorator block immediately above the `proof(` handler.
      const block = /@Get\('[^']*proof[^']*'\)([\s\S]*?)\n {2}(?:async )?proof\(/.exec(src);
      expect(block).not.toBeNull();
      expect(block?.[1]).toContain("@RequirePermissions('money.topups.review')");
    });

    it('no OTHER handler mints a top-up proof link', () => {
      // If a third surface appears, it has to be brought under the same
      // rule rather than inheriting a read key the way these two did.
      const minting = controllerFiles(SRC)
        .filter((f) => /proofUrl\(/.test(withoutComments(readFileSync(f, 'utf8'))))
        .map((f) => f.slice(SRC.length + 1))
        .sort();
      expect(minting).toEqual(
        [
          ...cases,
          // Self-reads: a seller's own claim, a store's own claim.
          'modules/reseller-store-wallet/controllers/store-wallet.controller.ts',
          'modules/wallet-topup/controllers/seller-topup.controller.ts',
        ].sort(),
      );
    });
  });
});
